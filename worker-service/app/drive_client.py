import json
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
import io

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google.oauth2 import service_account

from .config import settings


@dataclass
class DriveFile:
    id: str
    name: str
    mime_type: str | None
    size_bytes: int | None


class DriveClient:
    def __init__(self):
        if settings.google_credentials:
            info = json.loads(Path(settings.google_credentials).read_text())
            creds = service_account.Credentials.from_service_account_info(info)
            self.service = build("drive", "v3", credentials=creds)
        elif settings.google_service_account_json:
            info = json.loads(settings.google_service_account_json)
            creds = service_account.Credentials.from_service_account_info(info)
            self.service = build("drive", "v3", credentials=creds)
        elif settings.google_api_key:
            self.service = build("drive", "v3", developerKey=settings.google_api_key)
        else:
            raise RuntimeError("Google API credentials not configured")

    def get_folder_name(self, folder_id: str) -> str:
        """Fetch the actual folder name from Google Drive."""
        try:
            folder = self.service.files().get(
                fileId=folder_id,
                fields='name'
            ).execute()
            return folder.get('name', folder_id)
        except Exception:
            return folder_id

    def list_files(self, folder_id: str, page_size: int = 1000) -> Iterator[DriveFile]:
        query = f"'{folder_id}' in parents and mimeType contains 'image/' and trashed = false"
        page_token: Optional[str] = None
        while True:
            resp = (
                self.service.files()
                .list(
                    q=query,
                    fields="nextPageToken, files(id, name, mimeType, size)",
                    pageSize=page_size,
                    pageToken=page_token,
                )
                .execute()
            )
            for file in resp.get("files", []):
                yield DriveFile(
                    id=file.get("id"),
                    name=file.get("name"),
                    mime_type=file.get("mimeType"),
                    size_bytes=int(file.get("size")) if file.get("size") else None,
                )
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

    def download_stream(self, file_id: str):
        request = self.service.files().get_media(fileId=file_id)
        buffer = io.BytesIO()
        downloader = MediaIoBaseDownload(buffer, request, chunksize=5 * 1024 * 1024)
        done = False
        while not done:
            status, done = downloader.next_chunk()
        buffer.seek(0)
        return buffer.read()
