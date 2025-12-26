from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from shared.models import Image
from ..dependencies import get_db
from ..schemas import ImageResponse

router = APIRouter(prefix="/images", tags=["images"])


@router.get("", response_model=list[ImageResponse])
def list_images(
    job_id: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    query = db.query(Image)
    if job_id:
        query = query.filter(Image.job_id == job_id)
    images = query.order_by(Image.created_at.desc()).offset(offset).limit(limit).all()
    return images


@router.get("/{image_id}", response_model=ImageResponse)
def get_image(image_id: str, db: Session = Depends(get_db)):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    return image
