export function getConstant(name: string, idl: { constants?: [{ name: string, value: any }] }): Uint8Array {
  if (!idl.constants) {
    throw new Error(`IDL does not contain constants section`);
  }

  const constant = idl.constants.find((obj: { name: string }) => obj.name === name);

  if (!constant) {
    throw new Error(`Constant "${name}" not found in IDL. Available constants: ${idl.constants.map(c => c.name).join(', ')}`);
  }

  return new Uint8Array(JSON.parse(constant.value));
}
