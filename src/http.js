"use strict";
const { fetch, ProxyAgent, Agent } = require("undici");
let dispatcher;
function fetchImage(url, options) {
  if (!dispatcher) {
    const proxy =
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy;
    dispatcher = proxy ? new ProxyAgent(proxy) : new Agent();
  }
  return fetch(url, { ...options, dispatcher });
}
function closeHTTP() {
  const current = dispatcher;
  dispatcher = undefined;
  return current ? current.destroy() : Promise.resolve();
}
module.exports = { fetchImage, closeHTTP };
