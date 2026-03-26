from enum import Enum

from pydantic import BaseModel


class ImageType(str, Enum):
    iso = "iso"
    cloud_image = "cloud_image"


class ImageDefinition(BaseModel):
    name: str
    type: ImageType
    download_url: str = ""
    nodes: list[str] = ["ALL"]


class ImageCreate(BaseModel):
    name: str
    type: ImageType
    download_url: str = ""
    nodes: list[str] = ["ALL"]


class ImageUpdate(BaseModel):
    download_url: str | None = None
    nodes: list[str] | None = None
