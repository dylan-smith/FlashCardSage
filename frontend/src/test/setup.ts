import '@testing-library/jest-dom/vitest'

// jsdom doesn't lay pages out, so it has no scrolling to do.
Element.prototype.scrollIntoView = () => {}
