from pathlib import Path

from fastapi import HTTPException

from app.models.image import ImageDefinition
from app.services import yaml_service


class ImageStore:
    def __init__(self, repo_path: str):
        self.images_file = Path(repo_path) / "images.yml"

    def list_all(self) -> list[ImageDefinition]:
        data = yaml_service.read_yaml(self.images_file)
        images = data.get("images", [])
        return [ImageDefinition(**img) for img in images]

    def get(self, name: str) -> ImageDefinition:
        for img in self.list_all():
            if img.name == name:
                return img
        raise HTTPException(status_code=404, detail=f"Image '{name}' not found")

    def _save_all(self, images: list[ImageDefinition]) -> None:
        data = {"images": [img.model_dump(mode="json") for img in images]}
        yaml_service.write_yaml(self.images_file, data)

    def write(self, image: ImageDefinition) -> None:
        images = self.list_all()
        for i, existing in enumerate(images):
            if existing.name == image.name:
                images[i] = image
                self._save_all(images)
                return
        images.append(image)
        self._save_all(images)

    def delete(self, name: str) -> None:
        images = self.list_all()
        new_images = [img for img in images if img.name != name]
        if len(new_images) == len(images):
            raise HTTPException(status_code=404, detail=f"Image '{name}' not found")
        self._save_all(new_images)
