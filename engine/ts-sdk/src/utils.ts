export function getConstantRaw(
  name: string,
  idl: { constants?: [{ name: string; value: any }] }
): any {
  if (!idl.constants) {
    throw new Error(`IDL does not contain constants section`);
  }

  const constant = idl.constants.find(
    (obj: { name: string }) => obj.name === name
  );

  if (!constant) {
    throw new Error(
      `Constant "${name}" not found in IDL. Available constants: ${idl.constants
        .map((c) => c.name)
        .join(", ")}`
    );
  }

  return constant.value;
}

export function getConstant(
  name: string,
  idl: { constants?: [{ name: string; value: any }] }
): Uint8Array {
  const value = getConstantRaw(name, idl);
  return new Uint8Array(JSON.parse(value));
}

export function getEnumVariants(
  enumName: string,
  idl: { types?: Array<{ name: string; type: { kind: string; variants?: Array<{ name: string }> } }> }
): Record<string, number> {
  if (!idl.types) {
    throw new Error(`IDL does not contain types section`);
  }

  const enumType = idl.types.find((t) => t.name === enumName);
  if (!enumType) {
    throw new Error(`Enum "${enumName}" not found in IDL types`);
  }

  if (enumType.type.kind !== "enum" || !enumType.type.variants) {
    throw new Error(`Type "${enumName}" is not an enum`);
  }

  const result: Record<string, number> = {};
  enumType.type.variants.forEach((variant, index) => {
    result[variant.name] = index;
  });

  return result;
}
