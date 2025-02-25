import {DAEMON_FILE_UPLOAD_URL} from "@shm/shared/constants";

export async function uploadFile(file: Blob): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
    method: "POST",
    body: formData,
  });
  const data = await response.text();
  return data as string; // CID
}
