'use strict';

// "LEFT AS IT WAS" HAS TO MEAN NOTHING HAPPENED.
//
// Loading an example over work somebody has done asks first, and answering
// no says "Left as it was." Render the example then went ahead and drew
// anyway -- not the example, which had not been loaded, but whatever the
// user had in the editor. So the button labelled Render the example drew
// their own half-finished configuration, under a line saying nothing had
// changed, and the board that came back was theirs with whichever feeds
// could not be fetched missing from it.

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, assert, assertEqual } = h;

  test('declining the confirm draws nothing at all', async () => {
    const { window, document } = loadEditor();
    // the user's own work, and a real edit so the confirm is asked for
    document.getElementById('importIn').value = 'https://mine.example/a.ics';
    click(document.getElementById('loadImport'));
    fireInput(document.querySelector('#calendars .card .title-input'), 'Robin');
    const mine = document.getElementById('jsonOut').value;

    click(document.querySelector('.mc-top nav a[href="#station-demo"]'));
    window.confirm = () => false;
    click(document.getElementById('renderExample'));
    await h.flush();

    assertEqual(document.getElementById('presetStatus').textContent, 'Left as it was.');
    assertEqual(document.getElementById('jsonOut').value, mine, 'the declined example loaded anyway');
    assertEqual(document.getElementById('previewStatus').textContent, '',
      'Render the example drew the user\'s own configuration after they said no');
    assert(document.getElementById('stage').hidden, 'a board was drawn when nothing was loaded');
  });
};
