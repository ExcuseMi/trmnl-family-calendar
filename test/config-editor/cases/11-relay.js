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

  // OFFERED, NAMED, AND NOT USED UNTIL IT IS CHOSEN. The relay is the one
  // route that sends a calendar key anywhere, so the offer says whose server
  // it goes to, and nothing leaves the page merely because the dialog opened.
  test('the relay is offered with its host named, and sends nothing until chosen', () => {
    const calls = [];
    const { document } = loadEditor((url) => {
      calls.push(String(url));
      return Promise.reject(new Error('no network in tests'));
    });
    fireInput(document.querySelectorAll('#calendars .card input[type=text]')[1],
      'https://cal.example.com/secret-address.ics');
    click(document.getElementById('copyPrompt'));
    assert(!document.getElementById('relayUse').hidden, 'a configured relay is not being offered');
    assert(/trmnl\.bettens\.dev/.test(document.getElementById('relayNote').textContent),
      'the offer does not say whose server the links would go to');
    assert(!calls.some((u) => /metro-calendar/.test(u)),
      'the relay was called before anybody chose it');
    assert(!document.getElementById('relayPaste').hidden, 'the paste route went missing');
    assert(!document.getElementById('relaySkip').hidden, 'there is no way past the dialog');
  });

  // THE REASON, NOT THE NUMBER. The relay answers a refusal with a sentence
  // ("that does not look like a calendar link"), and the reader can act on
  // that sentence. It used to arrive as "HTTP 502": Cloudflare replaces a
  // 5xx body with its own page, so the relay now refuses with a 422, and the
  // editor reads the body rather than the status.
  test('a refusal from the relay shows the relay\'s own reason', async () => {
    const { document } = loadEditor((url) => {
      if (/metro-calendar\/ics/.test(String(url))) {
        return Promise.resolve({ ok: false, status: 422,
          text: () => Promise.resolve('that does not look like a calendar link') });
      }
      return Promise.reject(new Error('no network in tests'));
    });
    fireInput(document.querySelectorAll('#calendars .card input[type=text]')[1],
      'https://cal.example.com/not-a-calendar');
    click(document.getElementById('copyPrompt'));
    click(document.getElementById('relayUse'));
    await new Promise((r) => setTimeout(r, 50));
    const st = document.getElementById('relayStatus').textContent;
    assert(/does not look like a calendar link/.test(st),
      'the reader was told a status code instead of why: ' + st);
  });

  // GENERATE IS THE FIRST PRESS, SO THAT IS WHERE IT ASKS. The offer used to
  // hang off Copy only, and Generate is the button people press first: they
  // read a prompt with no events in it, copied nothing, and never saw the
  // relay at all.
  test('generating a prompt with unread feeds offers the relay too', () => {
    const document = withUnreadCalendar();
    click(document.getElementById('makePrompt'));
    assert(!document.getElementById('relayOffer').hidden,
      'Generate made an event-less prompt without offering a way to read the feeds');
    assert(/secret-address\.ics/.test(document.getElementById('relayList').textContent),
      'the offer does not list the link it would send');
  });

  test('"copy anyway" is a way through, not a dead end', () => {
    const document = withUnreadCalendar();
    click(document.getElementById('copyPrompt'));
    click(document.getElementById('relaySkip'));
    assert(document.getElementById('relayOffer').hidden, 'the offer stayed up');
    assert(document.getElementById('promptOut').value.length > 0, 'no prompt was generated to copy');
  });
};
