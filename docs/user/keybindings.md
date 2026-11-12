# Keyboard shortcuts

Avanzel has no main window; it wakes up on a shortcut. Change any of them in Settings → General,
and Settings → Dictation for Right Option. The menu bar menu shows the current ones.

| Shortcut | What happens |
|---|---|
| ⌥Space | Start talking; press again to stop. A capsule above the Dock shows the waveform, then the transcript while your agent files it, then the pages it touched, with Undo and Open. Esc cancels. |
| ⌥⇧S | Capture the screen and say why it matters. The screenshot, the app, the page and your comment wait in the inbox for the evening review. |
| ⌥⇧Space | Type a thought. |
| ⌥⇧A | Ask your library; the answer links to the pages it used. Before your first question, Ask suggests a few about what you filed last. **Save as a page** keeps an answer as a page in your library, and in a git library its **Undo** takes the save back. |
| ⌥⇧Z | Undo the last filing, from any app. |
| Right Option | Tap to dictate into the app that has focus; the words are pasted at the cursor. See *Dictate into any app* in [Avanzel for Mac](mac-app.md#dictating-into-any-app). |

**Esc** cancels a dictation from any app while Avanzel is listening (it is a global shortcut
for that moment only), and the recording is dropped.

## When a shortcut doesn't work

- **A shortcut another app holds** does nothing when pressed (⌥Space is also the default of
  Alfred, Raycast, ChatGPT and Superwhisper). When macOS reports a shortcut as taken, the capsule
  names it once, as soon as there is a library, with the app that probably holds it and two free
  shortcuts to pick; Settings → General offers the same, and the menu bar menu stops showing the
  taken one. macOS can't always tell, so if ⌥Space opens another app, pick another shortcut in
  Settings → General.
- **Setup** checks that ⌥Space really reaches Avanzel. When another app holds it, or you reach
  for it in the setup window (⌥ goes down) and no press follows within 3 s, it names the likely
  app and offers two free shortcuts. Reading, thinking or typing there never brings that up.
