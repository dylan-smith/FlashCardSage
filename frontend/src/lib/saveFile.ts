// Has the browser save the file with this name, as a download. The browser makes the name safe for the user's files.
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // Kept until the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
