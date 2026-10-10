/** Fired after the list changes outside a page reload, so the NavBar can recount what's out. */
export const LIST_CHANGED_EVENT = "kurisu:list-changed";

export function notifyListChanged(): void {
  window.dispatchEvent(new Event(LIST_CHANGED_EVENT));
}
