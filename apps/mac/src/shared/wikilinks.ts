// How a page is linked in the library's Markdown, for the Ask window and for setup's Ask step alike.

/**
 * A `[[name]]`, `[[name|label]]` or `[[name#heading|label]]` link. Its groups are the page's name and the label, which
 * is undefined when the link has none. It is global: use it with `replace` or `matchAll`, which start from the
 * beginning each time, and never with `exec` or `test`, which would carry on from where the last use stopped.
 */
export const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

/** A page's name, as a link gives it: the file name of its library path (`rel`) without ".md". */
export const pageName = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1).replace(/\.md$/, "");
