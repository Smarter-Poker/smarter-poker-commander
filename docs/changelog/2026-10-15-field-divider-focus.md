# Internal Dividers Are Not Focus Frames

The shared focus owner now requires opposing border edges before treating an element as an enclosing frame. A single separator inside a search or select well no longer draws a second focus rectangle inside that well. The sixth ownership regression fails before the correction and passes afterward; the same handler was verified in Chromium with a divider inside a painted search frame.

Follow-up to the initial focus release in PR #151. Field values, authentication and requests remain unchanged.
