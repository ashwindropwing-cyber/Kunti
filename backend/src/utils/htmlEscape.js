/**
 * Escapes HTML special characters in a string to prevent XSS / HTML injection.
 * @param {string} str The string to escape.
 * @returns {string} The escaped string.
 */
function escapeHTML(str) {
  if (typeof str !== "string") {
    return str;
  }
  return str.replace(/[&<>'"]/g, (tag) => {
    const chars = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return chars[tag] || tag;
  });
}

module.exports = { escapeHTML };
