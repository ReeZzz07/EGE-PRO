// Тонкий клиент к локальному Docker-стеку (nginx-шлюз на localhost:8080) для скриптов импорта —
// замена @supabase/supabase-js: .from() через настоящий PostgrestClient (протокол не поменялся),
// вход/загрузка файлов — через свои /auth и /storage эндпоинты (см. docker/api/server.js).
import { PostgrestClient } from "@supabase/postgrest-js";

export async function connectLocalBackend({ baseUrl, email, password }) {
  const resp = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`Вход не удался: ${json.error?.message ?? resp.statusText}`);
  const token = json.access_token;
  const user = json.data.user;

  const pg = new PostgrestClient(`${baseUrl}/rest/v1`, {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },
  });

  async function uploadFile(bucket, relPath, bytes, contentType) {
    const form = new FormData();
    form.append("bucket", bucket);
    form.append("path", relPath);
    form.append("file", new Blob([bytes], { type: contentType }), relPath.split("/").pop());
    const r = await fetch(`${baseUrl}/storage/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    if (!r.ok) throw new Error(`Загрузка ${relPath} не удалась: ${(await r.text()).slice(0, 300)}`);
  }

  async function removeFiles(bucket, paths) {
    const r = await fetch(`${baseUrl}/storage/remove`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ bucket, paths }),
    });
    if (!r.ok) throw new Error(`Удаление файлов не удалось: ${(await r.text()).slice(0, 300)}`);
  }

  return { from: pg.from.bind(pg), uploadFile, removeFiles, user, token };
}
