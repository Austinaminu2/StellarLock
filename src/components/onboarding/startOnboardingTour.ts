export const START_EVENT = "stellarlock:start-onboarding-tour"

/** Trigger the onboarding tour from anywhere in the app (e.g. a "Replay tour" button in Settings). */
export function startOnboardingTour() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(START_EVENT))
}
