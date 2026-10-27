// Registers a custom element unless that name is already taken. Home
// Assistant imports the panel module again when the panel is re-registered
// under a new URL while a tab stays open (a restart after an update), and a
// second `customElements.define` of the same name throws, taking the whole
// module down with it. The first definition stays in charge until the page
// reloads, which is what a plain reload gives the user anyway.

export function define(name: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(name)) customElements.define(name, ctor);
}
