"""Discover B2 bucket endpoint + generate UPI key for deployment."""
import base64
import json
import urllib.request

from cryptography.fernet import Fernet

upi_key = Fernet.generate_key().decode()
print(f"UPI_KEY={upi_key}")

# Try B2 auth v2 API (widely supported)
b2_key_id = "6adfc5a171f7"
b2_app_key = "0058fc7fb4f2cdf6165ef831d6b2209566658cb6e3"
auth = base64.b64encode(f"{b2_key_id}:{b2_app_key}".encode()).decode()

for ver in ["v2", "v3", "v1"]:
    try:
        req = urllib.request.Request(
            f"https://api.backblazeb2.com/b2api/{ver}/b2_authorize_account",
            headers={"Authorization": f"Basic {auth}"},
        )
        data = json.loads(urllib.request.urlopen(req).read())
        print(f"AUTH_VER={ver}")
        print(f"DATA_KEYS={list(data.keys())}")
        s3url = data.get("s3ApiUrl") or data.get("downloadUrl", "")
        print(f"B2_S3_URL={s3url}")
        api_url = data.get("apiUrl") or data.get("apiInfo", {}).get("storageApi", {}).get("apiUrl", "")
        auth_token = data.get("authorizationToken", "")
        acct_id = data.get("accountId", "")
        print(f"API_URL={api_url}  ACCT={acct_id}")

        if api_url and acct_id:
            req2 = urllib.request.Request(
                f"{api_url}/b2api/{ver}/b2_list_buckets?accountId={acct_id}",
                headers={"Authorization": auth_token},
            )
            buckets = json.loads(urllib.request.urlopen(req2).read())
            for b in buckets.get("buckets", []):
                print(f"BUCKET={b['bucketName']} type={b['bucketType']}")
        break
    except Exception as e:
        print(f"FAILED_VER={ver} err={e}")
