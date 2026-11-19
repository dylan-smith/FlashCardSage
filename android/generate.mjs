// Generates the Android project in android/project from twa-manifest.json, with Bubblewrap's generator. The project
// isn't committed: it's all made from the manifest, so the workflow (.github/workflows/android.yml) generates it and
// builds it with its Gradle wrapper.
//
// The app's icons come from frontend/public in this checkout rather than from the live site, so a build doesn't
// depend on what's deployed. Bubblewrap only fetches icons over HTTP, so they're served from here while it runs.
// ANDROID_VERSION_CODE and ANDROID_VERSION_NAME, when set, replace the manifest's version, which Play needs to go up
// with every upload.
import { createServer } from 'node:http'
import { readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConsoleLog, TwaGenerator, TwaManifest } from '@bubblewrap/core'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = join(here, '..', 'frontend', 'public')
const projectDir = join(here, 'project')

const manifest = await TwaManifest.fromFile(join(here, 'twa-manifest.json'))
if (process.env.ANDROID_VERSION_CODE) {
  manifest.appVersionCode = Number(process.env.ANDROID_VERSION_CODE)
}
if (process.env.ANDROID_VERSION_NAME) {
  manifest.appVersionName = process.env.ANDROID_VERSION_NAME
}

const server = createServer((request, response) => {
  readFile(join(publicDir, new URL(request.url, 'http://localhost').pathname))
    .then((file) => {
      response.writeHead(200, { 'Content-Type': 'image/png' })
      response.end(file)
    })
    .catch(() => {
      response.writeHead(404)
      response.end()
    })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const local = `http://127.0.0.1:${server.address().port}`
for (const field of ['iconUrl', 'maskableIconUrl']) {
  manifest[field] = local + new URL(manifest[field]).pathname
}

try {
  await rm(projectDir, { recursive: true, force: true })
  await new TwaGenerator().createTwaProject(
    projectDir,
    manifest,
    new ConsoleLog('generate'),
  )
  console.log(
    `Generated ${manifest.packageId} ${manifest.appVersionName} (${manifest.appVersionCode}) in ${projectDir}`,
  )
} finally {
  // The generator's fetches keep their connections open, which would keep this running.
  server.closeAllConnections()
  server.close()
}
