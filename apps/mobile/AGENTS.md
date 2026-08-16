# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## UI parity

The 390px-wide pure layout is the interaction and visual specification for
the native app. Reimplement it with React Native components; do not use a
WebView and do not invent a second visual language.

Keep semantic icon choices aligned with `components/ChatInput.tsx` through
`src/WebAlignedIcon.tsx`: model = chip, thinking = bulb, tools = wrench,
attachment = image, compaction = contract. Never substitute a generic settings
gear for model selection.

Message parity lives in `src/MessageView.tsx`: user messages are right-aligned
85% bubbles; assistant messages are unframed; thinking and tool calls are
compact transparent process rows. Match Web spacing and typography before
adding native-only embellishment.
