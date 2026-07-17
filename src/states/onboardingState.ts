import { createSignal } from "solid-js";

// Onboarding completion isn't persisted yet , see the commented-out
// `set_general_settings` call in Onboarding.tsx, kept inactive on purpose so
// every relaunch shows onboarding again while it's being tested. Without
// this in-memory flag, finishing onboarding and navigating to "/" would just
// bounce straight back since `hasCompletedOnboarding` never actually flips.
export const [onboardingJustFinished, setOnboardingJustFinished] = createSignal(false);
