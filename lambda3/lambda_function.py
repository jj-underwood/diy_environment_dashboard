from datetime import datetime
import json
import jwt
import logging
import os

secret_key = os.environ['JWT_SECRET_KEY']

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    token = event.get('authorizationToken')
    
    if not token:
        logger.info("Token not found")
        raise Exception("Unauthorized")
    if not token.startswith("Bearer "):
        logger.info("Token format error")
        raise Exception("Unauthorized")
    try:
        token = token.split(" ")[1]
        decoded_token = jwt.decode(token, secret_key, algorithms=['HS256'])
        if 'exp' in decoded_token and is_token_expired(decoded_token['exp']):
            logger.info("token expired")
            raise Exception("Unauthorized")
        return generate_policy(decoded_token['sub'], 'Allow', event['methodArn'])
    except IndexError:
        logger.info("IndexError")
        raise Exception("Unauthorized")
    except jwt.ExpiredSignatureError:
        logger.info("ExpiredSignatureError")
        raise Exception("Unauthorized")
    except jwt.InvalidTokenError:
        logger.info("InvalidTokenError")
        return generate_policy(None, 'Deny', event['methodArn'])

def generate_policy(principal_id, effect, resource):
    policy_document = {
        'Version': '2012-10-17',
        'Statement': []
    }

    if effect and resource:
        policy_document['Statement'].append({
            'Action': 'execute-api:Invoke',
            'Effect': effect,
            'Resource': resource
        })

    return {
        'principalId': principal_id or 'anonymous',
        'policyDocument': policy_document
    }

def is_token_expired(exp):
    current_time = datetime.utcnow().timestamp()
    return current_time > exp

