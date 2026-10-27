// happy-dom fires selectionchange while the selection is being set; browsers
// queue one as a task, however often the selection changed meanwhile.
// CodeMirror sets the selection inside an update, so the synchronous event
// would start a second update within the first.
const dispatch = document.dispatchEvent.bind(document);
let queued = false;
document.dispatchEvent = (event: Event): boolean => {
  if (event.type !== "selectionchange") return dispatch(event);
  if (!queued) {
    queued = true;
    setTimeout(() => {
      queued = false;
      dispatch(event);
    });
  }
  return true;
};
