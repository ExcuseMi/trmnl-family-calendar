'use strict';

// A CALENDAR LINK IS A PASSWORD IN A URL.
//
// Google calls it a "secret address", and anyone holding it can read that
// calendar until it is regenerated. The relay exists because nothing else
// works -- a calendar feed sends no CORS header, so this page cannot read
// one and no assistant can fetch one either -- but using it means handing
// somebody's calendar key to a server. So it is asked for, every time, with
// the links it would send listed, and it is never the default.

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, assert } = h;

  function withUnreadCalendar() {
    const { document } = loadEditor();
    const url = document.querySelectorAll('#calendars .card input[type=text]')[1];
    fireInput(url, 'https://cal.example.com/secret-address.ics');
    return document;
  }

  test('copying a prompt with unread feeds asks before it copies', () => {
    const document = withUnreadCalendar();
    assert(document.getElementById('relayOffer').hidden, 'the offer is showing before anything asked for it');
    click(document.getElementById('copyPrompt'));
    assert(!document.getElementById('relayOffer').hidden, 'copying said nothing about the unread feeds');
    // and it names exactly what it would send
    assert(/secret-address\.ics/.test(document.getElementById('relayList').textContent),
      'the offer does not list the link it would send');
  });

  test('with every feed read it just copies, and never mentions a relay', () => {
    const { document } = loadEditor();
    click(document.getElementById('copyPrompt'));
    assert(document.getElementById('relayOffer').hidden, 'it asked about feeds that do not exist');
  });

  // A BUTTON THAT CANNOT WORK IS WORSE THAN NO BUTTON, and this one would be
  // asking for calendar links in order to send them nowhere. Until an
  // endpoint is set, the offer is the two routes that need no server.
  test('with no relay configured, the relay is not offered at all', () => {
    const document = withUnreadCalendar();
    click(document.getElementById('copyPrompt'));
    assert(document.getElementById('relayUse').hidden,
      'a relay with no endpoint is still being offered');
    assert(!document.getElementById('relayPaste').hidden, 'the paste route went missing');
    assert(!document.getElementById('relaySkip').hidden, 'there is no way past the dialog');
  });

  test('"copy anyway" is a way through, not a dead end', () => {
    const document = withUnreadCalendar();
    click(document.getElementById('copyPrompt'));
    click(document.getElementById('relaySkip'));
    assert(document.getElementById('relayOffer').hidden, 'the offer stayed up');
    assert(document.getElementById('promptOut').value.length > 0, 'no prompt was generated to copy');
  });
};
