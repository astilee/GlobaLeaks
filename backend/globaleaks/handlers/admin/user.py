import json
from nacl.encoding import Base64Encoder
from twisted.internet.defer import inlineCallbacks

from globaleaks import models
from globaleaks.handlers.admin.operation import set_tmp_key
from globaleaks.handlers.base import BaseHandler
from globaleaks.handlers.user import parse_pgp_options, \
                                     user_serialize_user
from globaleaks.handlers.user.reset_password import db_generate_password_reset_token
from globaleaks.models import Config, UserProfile, fill_localized_keys
from globaleaks.orm import db_del, db_get, db_log, transact, tw
from globaleaks.rest import errors, requests
from globaleaks.state import State
from globaleaks.transactions import db_get_user
from globaleaks.utils.crypto import GCE, generateRandomPassword, sha256
from globaleaks.utils.utility import datetime_now, datetime_null, uuid4
from sqlalchemy import or_

protected_profiles = {'admin': 'Admin', 'receiver': 'Receiver', 'analyst': 'Analyst', 'custodian': 'Custodian'}

def serialize_user_profile(user):
    """
    Serialize a user profile object into a dictionary format.

    :param user: The user profile object to serialize.
    :return: A dictionary containing user profile data.
    """
    user_profile = {
        'id': user.id,
        'tid': user.tid,
        'name': user.name,
        'role': user.role,
        'can_edit_general_settings': user.can_edit_general_settings,
        'can_delete_submission': user.can_delete_submission,
        'can_postpone_expiration': user.can_postpone_expiration,
        'can_grant_access_to_reports': user.can_grant_access_to_reports,
        'can_redact_information': user.can_redact_information,
        'can_mask_information': user.can_mask_information,
        'can_transfer_access_to_reports': user.can_transfer_access_to_reports,
        'forcefully_selected': user.forcefully_selected,
        'custom': user.custom,
    }

    return user_profile

def db_create_user_profile(session, tid, request):
    """
    Transaction for creating a new user

    :param user_session: The session of the user performing the operation
    :param request: The request data
    :return: The serialized descriptor of the created object
    """
    request['tid'] = tid
    user = models.UserProfile(request)

    for key, value in request.items():
        setattr(user, key, value)
    
    existing_user = session.query(models.UserProfile).filter(models.UserProfile.tid == user.tid, models.UserProfile.name == user.name, models.UserProfile.role == user.role).first()
    if existing_user:
        raise errors.DuplicateUserError

    session.add(user)

    session.flush()

    return serialize_user_profile(user)

@transact
def db_delete_user_profile(session, user_id, tid):

    user = session.query(models.UserProfile).filter(models.UserProfile.tid == tid, models.UserProfile.id == user_id).first()

    if not user:
        raise ValueError

    if user.role in protected_profiles and user.name == protected_profiles[user.role]:
        raise errors.ForbiddenOperation

    if session.query(models.User).filter(models.User.profile_id == user_id).first():
        raise errors.ForbiddenOperation

    session.delete(user)
    session.commit()

@transact
def create_user_profile(session, tid, request):
    """
    Transaction for creating a new user

    :param session: An ORM session
    :param request: The request data
    :return: The serialized descriptor of the created object
    """
    return db_create_user_profile(session, tid, request)

@transact
def db_admin_update_user_profile(session, user_id, tid, request):
    """
    Update the user profile in the database.
    
    :param session: An ORM session
    :param user_id: The ID of the user to update
    :param request: The new data for updating the user profile
    :return: The updated user object
    """
    user = session.query(models.UserProfile).filter(models.UserProfile.tid == tid, models.UserProfile.id == user_id).first()
    
    for key, value in request.items():
        if hasattr(user, key):
            setattr(user, key, value) 

    session.commit()

    return serialize_user_profile(user)

@transact
def db_get_user_profiles(session, tid):
    """
    Retrieve all user profiles from the database.
    
    :param session: ORM session
    :return: List of user profiles in serialized form
    """
    default_profile_exists = session.query(Config).filter_by(tid=tid, var_name='default_profile').first()

    if default_profile_exists:
        users = session.query(models.UserProfile).filter(or_(models.UserProfile.tid == tid,
            models.UserProfile.tid == int(default_profile_exists.value))).all()
    else:
        users = session.query(models.UserProfile).filter(models.UserProfile.tid == tid).all()

    user_profiles = []
    for user in users:
        if user.role in protected_profiles and user.name == protected_profiles[user.role]:
           continue
        user_data = serialize_user_profile(user)
        user_profiles.append(user_data)

    return user_profiles

def db_create_user(session, tid, user_session, request, language):
    """
    Transaction for creating a new user

    :param session: An ORM session
    :param tid: A tenant ID
    :param user_session: The session of the user performing the operation
    :param request: The request data
    :param language: The language of the request
    :return: The serialized descriptor of the created object
    """
    config = models.config.ConfigFactory(session, tid)

    encryption = config.get_val('encryption')

    request['tid'] = tid

    fill_localized_keys(request, models.User.localized_keys, language)

    if not request['public_name']:
        request['public_name'] = request['name']

    user = models.User(request)

    if not request['username']:
        user.username = user.id = uuid4()

    existing_user = session.query(models.User).filter(models.User.tid == user.tid, models.User.username == user.username).first()
    if existing_user:
        raise errors.DuplicateUserError

    salt = config.get_val('receipt_salt')
    user.salt = GCE.generate_salt(salt + ":" + user.username)

    user.language = request['language']

    # The various options related in manage PGP keys are used here.
    parse_pgp_options(user, request)

    password = request.get('password', '')
    if not password:
        password = generateRandomPassword(16)
        key = Base64Encoder.decode(GCE.derive_key(password, user.salt).encode())
    else:
        key = Base64Encoder.decode(password)

    user.hash = sha256(key)

    session.add(user)

    session.flush()

    # After flush align date to user.creation_date
    user.password_change_date = user.creation_date

    if user_session:
        db_log(session, tid=tid, type='create_user', user_id=user_session.user_id, object_id=user.id)

    if request.get('send_activation_link', False):
        token = db_generate_password_reset_token(session, user)
    else:
        token = None

    crypto_escrow_pub_key_tenant_1 = models.config.ConfigFactory(session, 1).get_val('crypto_escrow_pub_key')
    crypto_escrow_pub_key_tenant_n = config.get_val('crypto_escrow_pub_key')

    if encryption and crypto_escrow_pub_key_tenant_1 or crypto_escrow_pub_key_tenant_n:
        cc, user.crypto_pub_key = GCE.generate_keypair()
        user.crypto_prv_key = Base64Encoder.encode(GCE.symmetric_encrypt(key, cc))
        user.crypto_bkp_key, user.crypto_rec_key = GCE.generate_recovery_key(cc)

        if user_session and token:
            set_tmp_key(user_session, user, token, cc)

    if not crypto_escrow_pub_key_tenant_1 and not crypto_escrow_pub_key_tenant_n:
        return user

    if crypto_escrow_pub_key_tenant_1:
        user.crypto_escrow_bkp1_key = Base64Encoder.encode(GCE.asymmetric_encrypt(crypto_escrow_pub_key_tenant_1, cc))

    if tid != 1 and crypto_escrow_pub_key_tenant_n:
        user.crypto_escrow_bkp2_key = Base64Encoder.encode(GCE.asymmetric_encrypt(crypto_escrow_pub_key_tenant_n, cc))

    return user


def db_delete_user(session, tid, user_session, user_id):
    current_user = db_get(session, models.User, models.User.id == user_session.user_id)
    user_to_be_deleted = db_get(session, models.User, models.User.id == user_id)

    if user_session.user_id == user_id:
        # Prevent users to delete themeselves
        raise errors.ForbiddenOperation
    elif user_to_be_deleted.crypto_escrow_prv_key and not user_session.ek:
        # Prevent users to delete privileged users when escrow keys could be invalidated
        raise errors.ForbiddenOperation

    db_del(session, models.User, (models.User.tid == tid, models.User.id == user_id))
    db_log(session, tid=tid, type='delete_user', user_id=user_session.user_id, object_id=user_id)


@transact
def create_user(session, tid, user_session, request, language):
    """
    Transaction for creating a new user

    :param session: An ORM session
    :param tid: A tenant ID
    :param request: The request data
    :param language: The language of the request
    :return: The serialized descriptor of the created object
    """
    user = db_create_user(session, tid, user_session, request, language)
    return user_serialize_user(session, user, language)


def db_admin_update_user(session, tid, user_session, user_id, request, language):
    """
    Transaction for updating an existing user

    :param session: An ORM session
    :param tid: A tenant ID
    :param user_session: The current user session
    :param user_id: The ID of the user to update
    :param request: The request data
    :param language: The language of the request
    :return: The serialized descriptor of the updated object
    """
    fill_localized_keys(request, models.User.localized_keys, language)

    user = db_get_user(session, tid, user_id)
    profile = session.query(UserProfile).filter(UserProfile.id == request['profile_id']).first()
    request['role'] = profile.role
    if request['mail_address'] != user.mail_address:
        user.change_email_token = None
        user.change_email_address = ''
        user.change_email_date = datetime_null()

    # Prevent administrators to reset password change needed status
    if user.password_change_needed:
        request['password_change_needed'] = True

    # The various options related in manage PGP keys are used here.
    parse_pgp_options(user, request)

    user.update(request)

    return user_serialize_user(session, user, language)


def db_get_users(session, tid, role=None, language=None):
    """
    Transaction for retrieving the list of users defined on a tenant

    :param session: An ORM session
    :param tid: A tenant ID
    :param role: The role of the users to be retriven
    :param language: The language to be used during serialization
    :return: A list of serialized descriptors of the users defined on the specified tenant
    """
    if role is None:
        users = session.query(models.User).filter(models.User.tid == tid)
    else:
        users = session.query(models.User).filter(models.User.tid == tid,
                                                  models.User.role == role)

    language = language or State.tenants[tid].cache.default_language

    return [user_serialize_user(session, user, language) for user in users]

def get_user(session, tid, id):
    """
    Return specific profile or user.
    """
    profile = session.query(models.UserProfile).filter(models.UserProfile.id == id, models.UserProfile.tid == tid).first()
    if profile:
        return serialize_user_profile(profile)
    
    user = session.query(models.User).filter(models.User.id == id, models.User.tid == tid).first()
    if user:
        return user_serialize_user(session, user, State.tenants[tid].cache.default_language)
    
    raise errors.NotFound
   

class UsersCollection(BaseHandler):
    check_roles = 'admin'
    invalidate_cache = True

    @inlineCallbacks
    def get(self):
        """
        Return all the users.
        """
        users = yield tw(db_get_users, self.request.tid, None, self.request.language)

        user_profiles = yield db_get_user_profiles(self.request.tid)

        response = {"users": users, "user_profiles": user_profiles}
    
        return response
    
    @inlineCallbacks
    def post(self):
        """
        Create a new user or user profile.
        """
        content = self.request.content.read().decode('utf-8')
        content_data = json.loads(content)
        profile_id = content_data.get("profile_id", "").strip()
        custom = content_data.get("custom", True)
        is_profile_id = profile_id != ""
    
        if not custom and not is_profile_id:
            user_profile_request = yield self.validate_request(content, requests.AdminUserProfileDesc)
            user_profile = yield create_user_profile(self.request.tid, user_profile_request)
    
            content_data["profile_id"] = user_profile["id"]
            is_profile_id = user_profile["id"]
    
        request_type = requests.AdminUserDesc if is_profile_id else requests.AdminUserProfileDesc
        request = yield self.validate_request(json.dumps(content_data), request_type)
    
        if is_profile_id:
            user = yield create_user(self.request.tid, self.session, request, self.request.language)
            return user
        else:
            profile = yield create_user_profile(self.request.tid, request)
            return profile


class UserInstance(BaseHandler):
    check_roles = 'admin'
    invalidate_cache = True

    def get(self, user_id):
        """
        Retrieve the specified user or user profile.
        """
        return tw(get_user, self.request.tid, user_id)

    @inlineCallbacks
    def put(self, user_id):
        """
         Update the specified user or user profile.
        """
        content = self.request.content.read().decode('utf-8')
        content_data = json.loads(content)
        profile_id = content_data.get("profile_id", "").strip()
        custom = content_data.get("custom")
        defualt_profile_id = content_data.get("defualt_profile_id")

        if profile_id:
            if not custom:
                content_data["custom"] = custom
                if content_data.get("profile_name") and content_data.get("profile_role"):
                    content_data["name"] = content_data.get("profile_name")
                    content_data["role"] = content_data.get("profile_role")
                profile_request = yield self.validate_request(json.dumps(content_data), requests.AdminUserProfileDesc)
                yield db_admin_update_user_profile(profile_id, self.request.tid, profile_request)

            user_request = yield self.validate_request(content, requests.AdminUserDesc)
            user = yield tw(db_admin_update_user,self.request.tid, self.session, user_id, user_request, self.request.language)
            
            if custom and defualt_profile_id:
                yield db_delete_user_profile(defualt_profile_id, self.request.tid)
            
            return user
        else:
            request = yield self.validate_request(content, requests.AdminUserProfileDesc)
            profile = yield db_admin_update_user_profile(user_id, self.request.tid, request)
            return profile

    @inlineCallbacks
    def delete(self, user_id):
        """
        Delete the specified user or user profile.
        """
        request_body = json.loads(self.request.content.read())
        is_profile = request_body.get("is_profile", False)
        profile_id = request_body.get("profile_id")
        
        if is_profile:
            profile = yield db_delete_user_profile(user_id, self.request.tid)
            return profile
        else:
            if profile_id:
                yield tw(db_delete_user, self.request.tid, self.session, user_id)
                profile = yield db_delete_user_profile(profile_id, self.request.tid)
                return profile
            user = yield tw(db_delete_user, self.request.tid, self.session, user_id)
            return user
