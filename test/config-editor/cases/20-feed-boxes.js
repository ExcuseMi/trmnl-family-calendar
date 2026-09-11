'use strict';

// THE FOLD UNDER THE MAP SAYS WHAT IS IN IT.
//
// Feeds that failed get a red card each, because a failure is the thing
// somebody has to act on; everything else folds away behind one line so six
// working feeds do not push the board off the top of the panel. That line
// read "The 6 feeds this was drawn from" whatever the state of them: before
// any draw at all, with nothing read and nothing drawn, a freshly pasted
// list of links was described as the feeds a board had been drawn from.
//
// It matters more than a wrong word, because the relay dialog's most
// private way out -- "Paste the .ics myself" -- sends the reader to the
// boxes inside that fold. The fold is shut, the boxes inside it are hidden
// until asked for, and the instruction was to press a button they could not
// see, under a heading saying the feeds had already been read.

module.exports = function (test, h) {
  const { loadEditor, click, assert } = h;

  function withTwoLinks() {
    const { document } = loadEditor();
    document.getElementById('importIn').value = 'https://a.example/x.ics\nhttps://b.example/y.ics';
    click(document.getElementById('loadImport'));
    return document;
  }
  const summary = (document) => document.querySelector('#sources summary').textContent;

  test('the feeds fold does not claim a draw that has not happened', () => {
    const document = withTwoLinks();
    const line = summary(document);
    assert(!/drawn from/.test(line),
      'nothing has been drawn, and the panel says these are the feeds it was drawn from: ' + line);
    assert(/none read yet/.test(line), 'the line does not say the feeds still need reading: ' + line);
  });

  test('the fold counts the feeds that have been read', () => {
    const document = withTwoLinks();
    const ta = document.querySelector('#sources textarea');
    ta.value = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
    ta.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    const line = summary(document);
    assert(/1 read/.test(line) && /1 not read yet/.test(line),
      'with one of two feeds read the fold should say so: ' + line);
  });

  test('"Paste the .ics myself" opens the boxes it sends the reader to', () => {
    const document = withTwoLinks();
    click(document.getElementById('makePrompt'));
    assert(!document.getElementById('relayOffer').hidden, 'sanity: the offer should be up');

    click(document.getElementById('relayPaste'));
    const details = document.querySelector('#sources details');
    assert(details && details.open,
      'the reader was sent to a box inside a fold that is still shut');
    const boxes = [...document.querySelectorAll('#sources textarea')];
    assert(boxes.length && boxes.every((b) => !b.hidden),
      'the boxes for the unread feeds are still hidden');
  });
};
