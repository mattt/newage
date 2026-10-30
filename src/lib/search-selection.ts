/** A result can be selected only while it answers the text still in the field. */
export function canSelectSearch(input: string, answered: string): boolean {
  return answered !== "" && input.trim().replace(/\s+/g, " ") === answered;
}
