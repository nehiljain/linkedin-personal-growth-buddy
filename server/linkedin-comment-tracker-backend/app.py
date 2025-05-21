import os
from supabase import create_client, Client
from chalice import Chalice, Response, CORSConfig
from datetime import datetime, timedelta
from dotenv import load_dotenv
import re
import pytz
from urllib.parse import urljoin

load_dotenv()

app = Chalice(app_name='linkedin-comment-tracker-backend')

# Allow all origins for development; restrict in production!
CORS_CONFIG = CORSConfig(
    allow_origin='*',
    allow_headers=['Content-Type'],
    max_age=600,
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError(
        "Missing SUPABASE_URL or SUPABASE_KEY environment variables. "
        "Please set them in your environment or .env file."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) 

@app.route('/')
def index():
    return {'hello': 'world'}


@app.route('/comment-event', methods=['POST', 'GET'], cors=CORS_CONFIG)
def comment_event():
    req = app.current_request
    if req.method == 'OPTIONS':
        # Chalice will handle CORS preflight automatically if cors=CORS_CONFIG is set
        return Response(body='', status_code=200, headers={})
    if req.method == 'POST':
        data = app.current_request.json_body
        print('[DEBUG] Incoming /comment-event POST data:', data)
        # Required fields in the incoming payload
        required_fields = [
            'text', 'comment_author_name', 'comment_author_profile', 'timestamp', 'postId',
            'post_author_name', 'post_author_profile', 'post_content'
        ]
        if not data or not all(field in data for field in required_fields):
            missing = [field for field in required_fields if field not in data]
            print(f'[ERROR] Missing required fields in /comment-event: {missing}')
            return Response(body={'error': 'Missing required fields.', 'missing': missing}, status_code=400)
        # Validate post_content is a list/array
        if not isinstance(data['post_content'], list):
            return Response(body={'error': 'post_content must be a list/array of objects.'}, status_code=400)
        # Regex-based ignore patterns
        ignore_phrases = [
            r'like', r'repost', r'comment', r'send', r'reply', r'add a comment…?', r'open emoji keyboard', r'✨ generate comment',
            r'activate to view larger image,?', r'add a comment\.\.\.', r'load more comments', r'follow', r'see more', r'see less',
            r'show more', r'show less', r'copy link', r'share', r'save', r'edit', r'delete', r'report', r'view more', r'view less',
            r'most relevant'
        ]
        # Add pattern for X comment(s) [on ...]
        ignore_patterns = [re.compile(p, re.IGNORECASE) for p in ignore_phrases]
        ignore_patterns.append(re.compile(r'^\d+\s*comment(s)?( on .*)?$', re.IGNORECASE))

        # Regex to match LinkedIn profile display photo URLs
        profile_photo_pattern = re.compile(r'^https://media\.licdn\.com/dms/image/v2/[^/]+/profile-displayphoto-shrink_100_100/profile-displayphoto-shrink_100_100/.*$')

        def is_profile_photo_url(entry):
            if not isinstance(entry, dict):
                return False
            data = entry.get('data', '')
            if not isinstance(data, str):
                return False
            return bool(profile_photo_pattern.match(data))

        def is_relevant(entry):
            if not isinstance(entry, dict):
                return False
            data = entry.get('data', '')
            if not isinstance(data, str):
                return True
            data_stripped = data.strip()
            for pat in ignore_patterns:
                if pat.fullmatch(data_stripped) or pat.search(data_stripped):
                    return False
            return True
        data['post_content'] = [entry for entry in data['post_content'] if is_relevant(entry) and not is_profile_photo_url(entry)]
        # Additional required non-empty fields
        # if not data['comment_author_name'] or not data['comment_author_profile']:
        #     return Response(body={'error': 'Missing or empty author name, author profile URL, or comment URL.'}, status_code=400)
        now = datetime.utcnow().isoformat() + 'Z'
        db_data = {
            'comment_text': data['text'],
            'author_name': data['comment_author_name'] or 'empty',
            'author_profile_url': data['comment_author_profile'] or 'empty',
            'event_timestamp': data['timestamp'],
            'comment_url': data.get('comment_url', 'empty'),
            'post_urn': data['postId'],
            'post_author_name': data['post_author_name'],
            'post_author_profile': data['post_author_profile'],
            'post_content': data['post_content'],
            'created_at': now,
            'updated_at': now
        }
        try:
            # Deduplication: check if comment_url already exists
            existing = supabase.table('comments').select('id').eq('comment_url', data['comment_url']).limit(1).execute()
            if existing.data and len(existing.data) > 0:
                return Response(body={'message': 'Duplicate comment, already exists.'}, status_code=200)
            result = supabase.table('comments').insert(db_data).execute()
            if result.data:
                return Response(body={'message': 'Comment event persisted.'}, status_code=201)
            else:
                return Response(body={'error': 'Failed to insert.'}, status_code=500)
        except Exception as e:
            return Response(body={'error': str(e)}, status_code=500)
    elif req.method == 'GET':
        params = req.query_params or {}
        author_profile = params.get('author_profile')
        # Normalize author_profile to full LinkedIn URL if needed
        if author_profile and not author_profile.startswith('https://www.linkedin.com/'):
            author_profile = urljoin('https://www.linkedin.com/', author_profile)
        limit = params.get('limit')
        offset = params.get('offset')
        start_date = params.get('start_date')
        end_date = params.get('end_date')

        # Validate required param
        if not author_profile:
            return Response(body={'error': 'Missing required query param: author_profile'}, status_code=400)
        try:
            query = supabase.table('comments').select('*').eq('author_profile_url', author_profile)
            # Date filters
            if start_date:
                query = query.gte('event_timestamp', start_date)
            if end_date:
                query = query.lte('event_timestamp', end_date)
            # Pagination
            if limit:
                try:
                    limit = int(limit)
                    if limit < 1:
                        raise ValueError
                except ValueError:
                    return Response(body={'error': 'limit must be a positive integer'}, status_code=400)
            else:
                limit = 100
            if offset:
                try:
                    offset = int(offset)
                    if offset < 0:
                        raise ValueError
                except ValueError:
                    return Response(body={'error': 'offset must be a non-negative integer'}, status_code=400)
            else:
                offset = 0
            query = query.range(offset, offset + limit - 1)
            query = query.order('event_timestamp', desc=True)
            result = query.execute()
            events = result.data if result.data else []
            return {'events': events}
        except Exception as e:
            return Response(body={'error': str(e)}, status_code=500)

@app.route('/comment-count', methods=['GET'], cors=CORS_CONFIG)
def comment_count():
    params = app.current_request.query_params or {}
    author_profile = params.get('author_profile')
    # Normalize author_profile to full LinkedIn URL if needed
    if author_profile and not author_profile.startswith('https://www.linkedin.com/'):
        author_profile = urljoin('https://www.linkedin.com/', author_profile)
    date = params.get('date')
    timezone = params.get('timezone')  # e.g., 'America/New_York'
    if not author_profile or not date:
        return Response(body={'error': 'Missing required query params: author_profile and date'}, status_code=400)
    try:
        # Default to UTC if timezone is missing or invalid
        if timezone:
            try:
                local_tz = pytz.timezone(timezone)
            except Exception:
                local_tz = pytz.UTC
        else:
            local_tz = pytz.UTC
        # Parse the local date in the user's timezone
        start_local = local_tz.localize(datetime.strptime(date, '%Y-%m-%d'))
        end_local = start_local + timedelta(days=1)
        # Convert to UTC for DB query
        start_utc = start_local.astimezone(pytz.UTC)
        end_utc = end_local.astimezone(pytz.UTC)
        start_iso = start_utc.isoformat()
        end_iso = end_utc.isoformat()
        query = (
            supabase.table('comments')
            .select('id')
            .eq('author_profile_url', author_profile)
            .gte('event_timestamp', start_iso)
            .lt('event_timestamp', end_iso)
        )
        result = query.execute()
        count = len(result.data) if result.data else 0
        return { 'count': count }
    except Exception as e:
        return Response(body={'error': str(e)}, status_code=500)

# The view function above will return {"hello": "world"}
# whenever you make an HTTP GET request to '/'.
#
# Here are a few more examples:
#
# @app.route('/hello/{name}')
# def hello_name(name):
#    # '/hello/james' -> {"hello": "james"}
#    return {'hello': name}
#
# @app.route('/users', methods=['POST'])
# def create_user():
#     # This is the JSON body the user sent in their POST request.
#     user_as_json = app.current_request.json_body
#     # We'll echo the json body back to the user in a 'user' key.
#     return {'user': user_as_json}
#
# See the README documentation for more examples.
#
