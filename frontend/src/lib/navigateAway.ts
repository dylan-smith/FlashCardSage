// Sends the browser to another site, such as back to an app once the user has answered its sign-in. It's on its own
// so tests can stand in for it, since jsdom can't leave the page.
export function navigateAway(url: string) {
  window.location.assign(url)
}
