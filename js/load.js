// Works out what a link or file is and hands it to the right source.
(function () {
  const LC = window.LC;
  const S = LC.sources;

  class NeedsFellowForm extends Error {}

  async function fromUrl(raw) {
    const url = raw.trim();
    if (!url) throw new Error("Paste a profile link first.");
    if (S.meticulous.matchUrl(url)) return S.meticulous.fetchUrl(url);
    if (S.decent.matchUrl(url)) return S.decent.fetchUrl(url);
    if (S.fellow.matchUrl(url)) throw new NeedsFellowForm("Fellow doesn't let other sites read brew.link. Copy the numbers into the form below.");
    if (/metprofiles\.link|visualizer\.coffee/i.test(url)) throw new Error("That link doesn't point at a single profile or shot. Open the profile and copy its address.");
    throw new Error("That link isn't from metprofiles.link, visualizer.coffee or brew.link.");
  }

  function fromJson(json) {
    if (S.meticulous.looksLike(json)) return S.meticulous.parse(json);
    if (S.decent.looksLikeShot(json)) return S.decent.parseShot(json, null);
    if (S.decent.looksLikeProfile(json)) return S.decent.parseProfile(json);
    if (S.fellow.looksLike(json)) return S.fellow.parse(json);
    throw new Error("This file isn't a Meticulous, Decent or Fellow profile.");
  }

  async function fromFile(file) {
    const text = await file.text();
    if (/\.tcl$/i.test(file.name) || /^\s*(advanced_shot|profile_title)\b/m.test(text)) {
      throw new Error("That's a Decent .tcl profile. Upload one of your shots to visualizer.coffee and paste its link instead.");
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch (_) {
      throw new Error("That file isn't valid JSON.");
    }
    return fromJson(json);
  }

  LC.load = { fromUrl, fromFile, fromJson, NeedsFellowForm };
})();
