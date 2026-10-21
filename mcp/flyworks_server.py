import os
import sys
from pathlib import Path
from typing import Literal, Optional

import httpx

sys.path.insert(0, str(Path(os.environ["FLYWORKS_SOURCE_DIR"]).resolve()))

from flyworks_mcp import server as upstream
from mcp.server.fastmcp import FastMCP


mcp = FastMCP("Flyworks")

MEDIA_DIR = Path(os.environ["FLYWORKS_MEDIA_DIR"]).resolve()
OUTPUT_DIR = Path(os.environ["FLYWORKS_OUTPUT_DIR"]).resolve()
STATUS_LABELS = {
    1: "waiting",
    2: "processing",
    3: "completed",
    4: "failed",
}


def require_token() -> Optional[dict]:
    if upstream.api_key:
        return None
    return {"error": "FLYWORKS_API_TOKEN is not configured."}


def resolve_media_file(file_path: str) -> Path:
    path = Path(file_path)
    if not path.is_absolute():
        path = MEDIA_DIR / path
    path = path.resolve()
    if not path.is_relative_to(MEDIA_DIR):
        raise ValueError(f"Local media must be inside {MEDIA_DIR}")
    if not path.is_file():
        raise ValueError(f"Local media file does not exist: {path}")
    return path


def output_path(file_name: str) -> Path:
    if Path(file_name).name != file_name or not file_name.lower().endswith(".mp4"):
        raise ValueError("file_name must be a plain .mp4 file name")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return OUTPUT_DIR / file_name


async def api_response(method: str, endpoint: str, **kwargs) -> dict:
    try:
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                f"{upstream.api_base_url}{endpoint}",
                headers=upstream.get_auth_headers(),
                timeout=30,
                **kwargs,
            )
        if response.status_code != 200:
            return {
                "error": f"Flyworks API returned HTTP {response.status_code}",
                "details": response.text[:1000],
            }
        return response.json()
    except (httpx.HTTPError, ValueError) as error:
        return {"error": f"Flyworks request failed: {error}"}


@mcp.tool(
    description=(
        "Create a Flyworks avatar task from exactly one image or video URL/local file. "
        "Local files must be inside the configured Flyworks media directory. "
        "Returns immediately with a task_id; use get_task_status with task_type='avatar'."
    )
)
async def create_avatar(
    image_url: Optional[str] = None,
    video_url: Optional[str] = None,
    image_file: Optional[str] = None,
    video_file: Optional[str] = None,
    title: str = "Generated Avatar",
    model: int = 2,
) -> dict:
    if error := require_token():
        return error
    sources = [image_url, video_url, image_file, video_file]
    if sum(value is not None for value in sources) != 1:
        return {"error": "Provide exactly one image_url, video_url, image_file, or video_file."}
    if model not in (1, 2):
        return {"error": "model must be 1 or 2."}

    payload = {"title": title}
    endpoint = "/avatar/create_by_image"
    try:
        if image_file or video_file:
            local_file = resolve_media_file(image_file or video_file or "")
            upload = await upstream.upload_file(str(local_file))
            if "error" in upload:
                return upload
            payload["file_id"] = upload["file_id"]
        elif image_url:
            payload["image_url"] = image_url
        else:
            endpoint = "/avatar/create_by_video"
            payload["video_url"] = video_url

        if video_file:
            endpoint = "/avatar/create_by_video"
        if endpoint.endswith("create_by_image"):
            payload["model"] = model
        return await api_response("POST", endpoint, json=payload)
    except ValueError as error:
        return {"error": str(error)}


@mcp.tool(
    description=(
        "Submit an asynchronous lip-sync video task using an existing avatar ID and audio. "
        "Provide exactly one audio URL or local audio file. Local files must be inside the "
        "configured Flyworks media directory. Returns a task_id without waiting."
    )
)
async def create_lipsync_video_by_audio(
    avatar: str,
    audio_url: Optional[str] = None,
    audio_file: Optional[str] = None,
    title: Optional[str] = None,
) -> dict:
    if error := require_token():
        return error
    if bool(audio_url) == bool(audio_file):
        return {"error": "Provide exactly one audio_url or audio_file."}
    try:
        safe_audio_file = str(resolve_media_file(audio_file)) if audio_file else None
    except ValueError as error:
        return {"error": str(error)}
    return await upstream.create_lipsync_video_by_audio(
        avatar=avatar,
        audio_url=audio_url,
        audio_file=safe_audio_file,
        title=title,
        async_mode=True,
    )


@mcp.tool(
    description=(
        "Submit an asynchronous text-driven lip-sync video task using an existing avatar ID. "
        "Text must contain 1-500 characters. Returns a task_id without waiting."
    )
)
async def create_lipsync_video_by_text(
    avatar: str,
    text: str,
    voice: Optional[str] = None,
    title: Optional[str] = None,
) -> dict:
    if error := require_token():
        return error
    if not 1 <= len(text) <= 500:
        return {"error": "text must contain 1-500 characters."}
    return await upstream.create_lipsync_video_by_text(
        avatar=avatar,
        text=text,
        voice=voice,
        title=title,
        async_mode=True,
    )


@mcp.tool(
    description=(
        "Check a Flyworks avatar or video task once. Returns waiting, processing, completed, "
        "or failed without polling. Completed video tasks include a temporary video URL."
    )
)
async def get_task_status(
    task_id: str,
    task_type: Literal["avatar", "video"] = "video",
) -> dict:
    if error := require_token():
        return error
    result = await api_response(
        "GET",
        f"/{task_type}/task",
        params={"task_id": task_id},
    )
    if "error" not in result:
        result["status_label"] = STATUS_LABELS.get(result.get("status"), "unknown")
    return result


@mcp.tool(
    description=(
        "Download a completed Flyworks video task into the configured output directory. "
        "file_name must be a plain .mp4 name. Call only after the task is completed."
    )
)
async def download_completed_video(task_id: str, file_name: str = "output.mp4") -> dict:
    if error := require_token():
        return error
    status = await get_task_status(task_id, "video")
    if "error" in status:
        return status
    if status.get("status") != 3:
        return {
            "error": "Video task is not completed.",
            "status": status.get("status"),
            "status_label": status.get("status_label"),
        }
    video_url = status.get("video_Url") or status.get("video_url")
    if not video_url:
        return {"error": "Completed task did not include a video URL.", "details": status}
    try:
        destination = output_path(file_name)
    except ValueError as error:
        return {"error": str(error)}
    result = await upstream.download_video(video_url, str(destination))
    result["task_id"] = task_id
    return result


def main() -> None:
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    mcp.run()


if __name__ == "__main__":
    main()
