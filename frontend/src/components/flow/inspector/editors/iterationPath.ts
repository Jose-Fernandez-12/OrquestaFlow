/**
 * Turns a path picked in a node's result into the variable a node in iteration mode uses.
 *
 * `{{_item}}` is each element of the list being iterated, which is the first array in the path:
 *   Nodo._data[0]                     -> _item
 *   Nodo._data[0].codigoEds           -> _item.codigoEds
 *   Nodo._data[0].numeroDocumentos[1] -> _item.numeroDocumentos[1]
 *   Nodo._data  (the list itself)     -> _item
 * A path with no list keeps only its last key, as the element's field: Nodo.total -> _item.total
 */
export function toIterationPath(path: string, isArray = false): string {
  const firstIndex = path.search(/\[\d+\]/);
  if (firstIndex !== -1) {
    const rest = path.substring(path.indexOf(']', firstIndex) + 1);
    return '_item' + rest;
  }
  if (isArray) return '_item';
  const lastDot = path.lastIndexOf('.');
  return lastDot !== -1 ? '_item.' + path.substring(lastDot + 1) : '_item';
}
