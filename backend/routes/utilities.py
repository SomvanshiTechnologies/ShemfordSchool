from fastapi import APIRouter, Request, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
import uuid
import os

from auth_utils import get_current_user

router = APIRouter()

UPLOADS_DIR = Path(__file__).parent.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

ALLOWED_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/jpg": ".jpg",
}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB


@router.post("/upload")
async def upload_file(request: Request, file: UploadFile = File(...), doc_type: str = "document"):
    await get_current_user(request)

    # Passport photo must be an image; all other documents must be PDF
    is_photo = doc_type == "passport_photo"
    content_type = file.content_type or ""
    ext = ALLOWED_TYPES.get(content_type)
    if not ext:
        name_lower = (file.filename or "").lower()
        if name_lower.endswith(".pdf"):
            ext = ".pdf"
        elif name_lower.endswith((".jpg", ".jpeg")):
            ext = ".jpg"
        elif name_lower.endswith(".png"):
            ext = ".png"
        else:
            raise HTTPException(
                status_code=400,
                detail="Only PDF, JPG, and PNG files are allowed"
            )

    if is_photo and ext == ".pdf":
        raise HTTPException(status_code=400, detail="Passport photo must be an image (JPG or PNG).")
    if not is_photo and ext != ".pdf":
        raise HTTPException(status_code=400, detail="Documents must be uploaded as PDF. For passport photo, upload JPG or PNG.")

    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large. Maximum size is 5 MB")

    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOADS_DIR / safe_name
    dest.write_bytes(data)

    backend_url = os.environ.get("BACKEND_URL", "http://localhost:8000")
    file_url = f"{backend_url}/uploads/{safe_name}"

    return {"file_url": file_url, "file_name": file.filename or safe_name}


@router.get("/file-view/{filename}")
async def view_uploaded_file(filename: str, request: Request):
    """Authenticated file view — serves an uploaded document through the API."""
    await get_current_user(request)
    # Prevent path traversal
    safe = Path(filename).name
    if safe != filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = UPLOADS_DIR / safe
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    import mimetypes
    mime, _ = mimetypes.guess_type(str(path))
    return FileResponse(path, media_type=mime or "application/octet-stream",
                        headers={"Content-Disposition": f"inline; filename={safe}"})


@router.get("/subjects")
async def get_subjects(request: Request):
    await get_current_user(request)
    return [
        "English", "Hindi", "Mathematics", "Science", "Social Science",
        "Physics", "Chemistry", "Biology", "Computer Science",
        "Economics", "Accountancy", "Business Studies", "History",
        "Geography", "Political Science", "Physical Education"
    ]


@router.get("/departments")
async def get_departments(request: Request):
    await get_current_user(request)
    return [
        "Teaching", "Administration", "Accounts", "IT",
        "Sports", "Library", "Laboratory", "Transport", "Security"
    ]
