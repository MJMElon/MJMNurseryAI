/* ════════════════════════════════════════════════════════════════════════
   WORKER LOCATIONS — where a section sits on the ground

   A worker is filed under a SECTION (PN, BNN, UNN1, …). A section sits in a
   LOCATION — Pre Nursery, Main Nursery, Estate — and the Main Nursery is
   more than one nursery, which is the only reason this file exists: the
   grouping is a fact about the company, and it was written down in two
   places that could disagree.

       scan/scan_workers.html        the Team Board's column headings
       scan/scan_system_setting.html the Location card

   There used to be a NON_LOCATION here holding Driver — a section that was
   not a place. It is gone: the Team Board is about where people work, and a
   driver belongs to the nursery he drives for. Driver survives as a ROLE,
   which is what it always described.

   Both read it from here now. A nursery added in Operation → Settings turns
   up under the right heading on both without either being edited.

   Locations RECOGNISE their sections rather than listing them. Naming would
   mean a UNN 3 created next year standing on its own until somebody
   remembered this file; a pattern takes it in.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* A nursery's code is its name with the spaces taken out: "UNN 1" files
     as UNN1, a new "UNN 3" as UNN3. A transcription, not a guess — the
     nurseries are named as codes with a space in them. */
  function code(name) {
    return String(name || '').replace(/\s+/g, '').toUpperCase();
  }

  var LOCATIONS = [
    { key: 'pre',    name: 'Pre Nursery',  match: function (c) { return c === 'PN'; } },
    { key: 'main',   name: 'Main Nursery',
      match: function (c) { return c === 'BNN' || /^UNN\d+$/.test(c); } },
    { key: 'estate', name: 'Estate',       match: function (c) { return c === 'UNE'; } }
  ];

  /* The nursery sections the register has always used. operation_nurseries
     does not necessarily carry all of them, and a section missing while
     people are still filed under it is a hole in the register. */
  var KEEP_NURSERIES = [
    { code: 'PN',   name: 'PN — Pre Nursery'  },
    { code: 'BNN',  name: 'BNN — Batu Niah'   },
    { code: 'UNN1', name: 'UNN1 — Ulu Niah 1' },
    { code: 'UNN2', name: 'UNN2 — Ulu Niah 2' }
  ];

  function locationOf(c) {
    for (var i = 0; i < LOCATIONS.length; i++) {
      if (LOCATIONS[i].match(c)) return LOCATIONS[i];
    }
    return null;
  }

  /* Sort the codes given into locations, in the order above, and hand back
     whatever matched none of them. Nothing is dropped: a caller that shows
     only the locations would hide a section, and a section nobody can see
     is one nobody fixes. */
  function group(codes) {
    var used = {}, out = LOCATIONS.map(function (loc) {
      var mine = codes.filter(function (c) {
        if (used[c] || !loc.match(c)) return false;
        used[c] = true;
        return true;
      });
      return { key: loc.key, name: loc.name, codes: mine };
    });
    return { locations: out, unplaced: codes.filter(function (c) { return !used[c]; }) };
  }

  global.MJMWorkerLocations = {
    code: code,
    locationOf: locationOf,
    group: group,
    LOCATIONS: LOCATIONS,
    KEEP_NURSERIES: KEEP_NURSERIES
  };
})(window);
