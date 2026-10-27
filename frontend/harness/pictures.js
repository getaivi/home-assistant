// The harness's pictures, for the harness only. Widget pictures are https
// URLs the device downloads itself, and the sample data keeps them so
// (Aivi takes nothing else). The preview draws them from those URLs; here
// the sample host's are served from frontend/harness/pictures/, so the
// harness and its screenshots need no network.

/** The sample data's picture host. */
export const PICTURE_HOST = "https://pictures.example.com/";

const LOCAL = new URL("./pictures/", import.meta.url);

/** `url` as the harness can load it: a sample picture from its folder,
 * anything else as it is. */
export function localPicture(url) {
  return typeof url === "string" && url.startsWith(PICTURE_HOST)
    ? new URL(url.slice(PICTURE_HOST.length), LOCAL).href
    : url;
}

const setAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name, value) {
  const local = this instanceof HTMLImageElement && name === "src" ? localPicture(value) : value;
  setAttribute.call(this, name, local);
};
