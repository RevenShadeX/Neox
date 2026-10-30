"use strict";
function validPrefix(value) {
  return (
    typeof value === "string" &&
    [...value].length >= 1 &&
    [...value].length <= 16 &&
    !/[\s\p{Cc}\p{Cf}]/u.test(value)
  );
}
module.exports = { validPrefix };
