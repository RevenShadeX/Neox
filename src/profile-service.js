"use strict";
const { ProfileRenderer, BoundedCache } = require("./profiles");
const { cleanName } = require("./text");
class ProfileService {
  constructor(
    client,
    {
      renderer = new ProfileRenderer(),
      timeout = 2000,
      maxConcurrent = 2,
    } = {},
  ) {
    this.client = client;
    this.renderer = renderer;
    this.timeout = timeout;
    this.maxConcurrent = maxConcurrent;
    this.active = 0;
    this.identities = new BoundedCache(128);
    this.identityRequests = new Map();
  }
  userIdentity(user, member, fallback) {
    return {
      displayName: cleanName(
        member?.displayName ||
          member?.nick ||
          user?.globalName ||
          user?.username ||
          fallback,
      ),
      avatarURL:
        member?.displayAvatarURL?.({
          extension: "png",
          size: 128,
          forceStatic: true,
        }) ||
        user?.displayAvatarURL?.({
          extension: "png",
          size: 128,
          forceStatic: true,
        }),
    };
  }
  async identity(profile, source) {
    const target = profile.userId,
      member = source.guild?.members?.cache?.get(target);
    if (source.user?.id === target)
      return this.userIdentity(source.user, source.member, profile.displayName);
    if (member)
      return this.userIdentity(member.user, member, profile.displayName);
    const cached = this.identities.get(target);
    if (cached) return cached;
    let user = this.client.users.cache.get(target),
      timer;
    try {
      if (
        !user &&
        this.client.isReady() &&
        (this.identityRequests.has(target) || this.identityRequests.size < 4)
      ) {
        let request = this.identityRequests.get(target);
        if (!request) {
          request = Promise.resolve()
            .then(() => this.client.users.fetch(target))
            .catch(() => null)
            .finally(() => this.identityRequests.delete(target));
          this.identityRequests.set(target, request);
        }
        user = await Promise.race([
          request,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(null), this.timeout);
            timer.unref?.();
          }),
        ]);
      }
    } catch {
    } finally {
      clearTimeout(timer);
    }
    const identity = this.userIdentity(user, null, profile.displayName);
    this.identities.set(target, identity, user ? 120000 : 30000);
    return identity;
  }
  async payload(result, source = {}) {
    if (this.active >= this.maxConcurrent)
      return {
        content: "⏳ Card rendering is busy. Try again shortly.",
        allowedMentions: { parse: [] },
      };
    this.active++;
    try {
      const profile = result.presentation.profile,
        identity = await this.identity(profile, source),
        image = await this.renderer.render(profile, identity);
      return image
        ? {
            content: "",
            files: [{ attachment: image, name: "neox-profile.png" }],
            allowedMentions: { parse: [] },
          }
        : {
        content: "⚠️ Could not render your card. Try again shortly.",
        allowedMentions: { parse: [] },
      };
    } catch {
      return {
        content: "⚠️ Could not render your card. Try again shortly.",
        allowedMentions: { parse: [] },
      };
    } finally {
      this.active--;
    }
  }
}
module.exports = { ProfileService };
