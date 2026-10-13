import { createPerceptualColorMapper } from "./colorMapping";

export interface ThemedCanvasOptions {
  background: string;
  foreground: string;
  saturation?: number;
  temperature?: number;
}

type ColorMapper = (color: string) => string;
type CanvasStyle = string | CanvasGradient | CanvasPattern;
type StyleProperty = "fillStyle" | "strokeStyle" | "shadowColor";

interface LogicalStyleSnapshot {
  fillStyle: CanvasStyle;
  strokeStyle: CanvasStyle;
  shadowColor: string;
}

interface ContextState extends LogicalStyleSnapshot {
  stack: LogicalStyleSnapshot[];
}

interface ThemeScope {
  mapper: ColorMapper | null;
  released: boolean;
}

interface SavedDescriptors {
  addColorStop: PropertyDescriptor;
  conicGradient?: PropertyDescriptor;
  fillStyle: PropertyDescriptor;
  height: PropertyDescriptor;
  linearGradient: PropertyDescriptor;
  radialGradient: PropertyDescriptor;
  restore: PropertyDescriptor;
  save: PropertyDescriptor;
  shadowColor: PropertyDescriptor;
  strokeStyle: PropertyDescriptor;
  width: PropertyDescriptor;
}

const mapperCache = new Map<string, ColorMapper>();
const MAX_CACHED_MAPPERS = 16;
const contextStates = new WeakMap<CanvasRenderingContext2D, ContextState>();
const contextByCanvas = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
const gradientMappers = new WeakMap<CanvasGradient, ColorMapper | null>();
const scopes: ThemeScope[] = [];

let activeMapper: ColorMapper | null = null;
let savedDescriptors: SavedDescriptors | null = null;

function requireDescriptor(
  target: object,
  property: PropertyKey,
): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(target, property);

  if (!descriptor) {
    throw new Error(`Canvas theme hook unavailable: ${String(property)}`);
  }

  return descriptor;
}

function requireAccessor(
  descriptor: PropertyDescriptor,
  property: string,
): Required<Pick<PropertyDescriptor, "get" | "set">> {
  if (!descriptor.get || !descriptor.set) {
    throw new Error(`Canvas theme accessor unavailable: ${property}`);
  }

  return {
    get: descriptor.get,
    set: descriptor.set,
  };
}

function requireMethod(
  descriptor: PropertyDescriptor,
  property: string,
): (...args: unknown[]) => unknown {
  if (typeof descriptor.value !== "function") {
    throw new Error(`Canvas theme method unavailable: ${property}`);
  }

  return descriptor.value as (...args: unknown[]) => unknown;
}

function currentStyleSnapshot(
  context: CanvasRenderingContext2D,
): LogicalStyleSnapshot {
  const state = contextStates.get(context);

  if (state) {
    return {
      fillStyle: state.fillStyle,
      strokeStyle: state.strokeStyle,
      shadowColor: state.shadowColor,
    };
  }

  if (!savedDescriptors) {
    return {
      fillStyle: context.fillStyle,
      strokeStyle: context.strokeStyle,
      shadowColor: context.shadowColor,
    };
  }

  const fill = requireAccessor(savedDescriptors.fillStyle, "fillStyle");
  const stroke = requireAccessor(savedDescriptors.strokeStyle, "strokeStyle");
  const shadow = requireAccessor(savedDescriptors.shadowColor, "shadowColor");

  return {
    fillStyle: fill.get.call(context) as CanvasStyle,
    strokeStyle: stroke.get.call(context) as CanvasStyle,
    shadowColor: shadow.get.call(context) as string,
  };
}

function getContextState(context: CanvasRenderingContext2D): ContextState {
  const existing = contextStates.get(context);
  if (existing) {
    return existing;
  }

  const snapshot = currentStyleSnapshot(context);
  const state: ContextState = {
    ...snapshot,
    stack: [],
  };

  contextStates.set(context, state);
  contextByCanvas.set(context.canvas, context);
  return state;
}

function setLogicalStyle(
  context: CanvasRenderingContext2D,
  property: StyleProperty,
  value: CanvasStyle | string,
): void {
  const state = getContextState(context);

  if (property === "shadowColor") {
    state.shadowColor = String(value);
    return;
  }

  state[property] = value as CanvasStyle;
}

function getLogicalStyle(
  context: CanvasRenderingContext2D,
  property: StyleProperty,
): CanvasStyle | string {
  const state = getContextState(context);
  return state[property];
}

function mapStyleValue(value: CanvasStyle | string): CanvasStyle | string {
  return typeof value === "string" && activeMapper
    ? activeMapper(value)
    : value;
}

function mapperFor(options: ThemedCanvasOptions | null): ColorMapper | null {
  if (!options) {
    return null;
  }

  const key = [
    options.background,
    options.foreground,
    options.saturation ?? 100,
    options.temperature ?? 0,
  ].join("|");
  const cached = mapperCache.get(key);

  if (cached) {
    mapperCache.delete(key);
    mapperCache.set(key, cached);
    return cached;
  }

  const mapper = createPerceptualColorMapper(options);
  mapperCache.set(key, mapper);
  if (mapperCache.size > MAX_CACHED_MAPPERS) {
    const oldest = mapperCache.keys().next().value;
    if (oldest !== undefined) mapperCache.delete(oldest);
  }
  return mapper;
}

function refreshActiveMapper(): void {
  activeMapper = scopes.at(-1)?.mapper ?? null;
}

function resetCanvasState(canvas: HTMLCanvasElement): void {
  const context = contextByCanvas.get(canvas);
  if (context) {
    contextStates.delete(context);
  }
}

function installHooks(): void {
  if (savedDescriptors) {
    return;
  }

  const contextPrototype = CanvasRenderingContext2D.prototype;
  const gradientPrototype = CanvasGradient.prototype;
  const canvasPrototype = HTMLCanvasElement.prototype;

  savedDescriptors = {
    addColorStop: requireDescriptor(gradientPrototype, "addColorStop"),
    conicGradient: Object.getOwnPropertyDescriptor(
      contextPrototype,
      "createConicGradient",
    ),
    fillStyle: requireDescriptor(contextPrototype, "fillStyle"),
    height: requireDescriptor(canvasPrototype, "height"),
    linearGradient: requireDescriptor(contextPrototype, "createLinearGradient"),
    radialGradient: requireDescriptor(contextPrototype, "createRadialGradient"),
    restore: requireDescriptor(contextPrototype, "restore"),
    save: requireDescriptor(contextPrototype, "save"),
    shadowColor: requireDescriptor(contextPrototype, "shadowColor"),
    strokeStyle: requireDescriptor(contextPrototype, "strokeStyle"),
    width: requireDescriptor(canvasPrototype, "width"),
  };

  const fill = requireAccessor(savedDescriptors.fillStyle, "fillStyle");
  const stroke = requireAccessor(savedDescriptors.strokeStyle, "strokeStyle");
  const shadow = requireAccessor(savedDescriptors.shadowColor, "shadowColor");
  const originalSave = requireMethod(savedDescriptors.save, "save");
  const originalRestore = requireMethod(savedDescriptors.restore, "restore");
  const originalLinearGradient = requireMethod(
    savedDescriptors.linearGradient,
    "createLinearGradient",
  );
  const originalRadialGradient = requireMethod(
    savedDescriptors.radialGradient,
    "createRadialGradient",
  );
  const originalConicGradient = savedDescriptors.conicGradient
    ? requireMethod(savedDescriptors.conicGradient, "createConicGradient")
    : null;
  const originalAddColorStop = requireMethod(
    savedDescriptors.addColorStop,
    "addColorStop",
  );
  const width = requireAccessor(savedDescriptors.width, "width");
  const height = requireAccessor(savedDescriptors.height, "height");

  const defineStyle = (
    property: StyleProperty,
    accessor: Required<Pick<PropertyDescriptor, "get" | "set">>,
  ): void => {
    const sourceDescriptor =
      property === "fillStyle"
        ? savedDescriptors?.fillStyle
        : property === "strokeStyle"
          ? savedDescriptors?.strokeStyle
          : savedDescriptors?.shadowColor;

    Object.defineProperty(contextPrototype, property, {
      configurable: true,
      enumerable: sourceDescriptor?.enumerable ?? false,
      get(this: CanvasRenderingContext2D) {
        return getLogicalStyle(this, property);
      },
      set(this: CanvasRenderingContext2D, value: CanvasStyle | string) {
        setLogicalStyle(this, property, value);
        accessor.set.call(this, mapStyleValue(value));
      },
    });
  };

  defineStyle("fillStyle", fill);
  defineStyle("strokeStyle", stroke);
  defineStyle("shadowColor", shadow);

  Object.defineProperty(contextPrototype, "save", {
    ...savedDescriptors.save,
    value: function save(this: CanvasRenderingContext2D): void {
      const state = getContextState(this);
      state.stack.push({
        fillStyle: state.fillStyle,
        strokeStyle: state.strokeStyle,
        shadowColor: state.shadowColor,
      });
      Reflect.apply(originalSave, this, []);
    },
  });

  Object.defineProperty(contextPrototype, "restore", {
    ...savedDescriptors.restore,
    value: function restore(this: CanvasRenderingContext2D): void {
      Reflect.apply(originalRestore, this, []);
      const state = getContextState(this);
      const previous = state.stack.pop();

      if (previous) {
        state.fillStyle = previous.fillStyle;
        state.strokeStyle = previous.strokeStyle;
        state.shadowColor = previous.shadowColor;
      }
    },
  });

  const defineGradientFactory = (
    property:
      | "createLinearGradient"
      | "createRadialGradient"
      | "createConicGradient",
    descriptor: PropertyDescriptor,
    original: (...args: unknown[]) => unknown,
  ): void => {
    Object.defineProperty(contextPrototype, property, {
      ...descriptor,
      value: function gradientFactory(
        this: CanvasRenderingContext2D,
        ...args: unknown[]
      ): CanvasGradient {
        const gradient = Reflect.apply(original, this, args) as CanvasGradient;
        gradientMappers.set(gradient, activeMapper);
        return gradient;
      },
    });
  };

  defineGradientFactory(
    "createLinearGradient",
    savedDescriptors.linearGradient,
    originalLinearGradient,
  );
  defineGradientFactory(
    "createRadialGradient",
    savedDescriptors.radialGradient,
    originalRadialGradient,
  );

  if (savedDescriptors.conicGradient && originalConicGradient) {
    defineGradientFactory(
      "createConicGradient",
      savedDescriptors.conicGradient,
      originalConicGradient,
    );
  }

  Object.defineProperty(gradientPrototype, "addColorStop", {
    ...savedDescriptors.addColorStop,
    value: function addColorStop(
      this: CanvasGradient,
      offset: number,
      color: string,
    ): void {
      const mapper = gradientMappers.has(this)
        ? gradientMappers.get(this) ?? null
        : activeMapper;

      Reflect.apply(originalAddColorStop, this, [
        offset,
        mapper ? mapper(color) : color,
      ]);
    },
  });

  Object.defineProperty(canvasPrototype, "width", {
    ...savedDescriptors.width,
    get: width.get,
    set(this: HTMLCanvasElement, value: number) {
      width.set.call(this, value);
      resetCanvasState(this);
    },
  });

  Object.defineProperty(canvasPrototype, "height", {
    ...savedDescriptors.height,
    get: height.get,
    set(this: HTMLCanvasElement, value: number) {
      height.set.call(this, value);
      resetCanvasState(this);
    },
  });
}

function uninstallHooks(): void {
  if (!savedDescriptors) {
    return;
  }

  const contextPrototype = CanvasRenderingContext2D.prototype;
  const gradientPrototype = CanvasGradient.prototype;
  const canvasPrototype = HTMLCanvasElement.prototype;

  Object.defineProperty(contextPrototype, "fillStyle", savedDescriptors.fillStyle);
  Object.defineProperty(
    contextPrototype,
    "strokeStyle",
    savedDescriptors.strokeStyle,
  );
  Object.defineProperty(
    contextPrototype,
    "shadowColor",
    savedDescriptors.shadowColor,
  );
  Object.defineProperty(contextPrototype, "save", savedDescriptors.save);
  Object.defineProperty(contextPrototype, "restore", savedDescriptors.restore);
  Object.defineProperty(
    contextPrototype,
    "createLinearGradient",
    savedDescriptors.linearGradient,
  );
  Object.defineProperty(
    contextPrototype,
    "createRadialGradient",
    savedDescriptors.radialGradient,
  );

  if (savedDescriptors.conicGradient) {
    Object.defineProperty(
      contextPrototype,
      "createConicGradient",
      savedDescriptors.conicGradient,
    );
  }

  Object.defineProperty(
    gradientPrototype,
    "addColorStop",
    savedDescriptors.addColorStop,
  );
  Object.defineProperty(canvasPrototype, "width", savedDescriptors.width);
  Object.defineProperty(canvasPrototype, "height", savedDescriptors.height);

  savedDescriptors = null;
  activeMapper = null;
}

export interface CanvasThemeScope {
  release(): void;
}

export function resetCanvasThemeState(canvas: HTMLCanvasElement): void {
  resetCanvasState(canvas);
}

export function beginCanvasThemeScope(
  options: ThemedCanvasOptions | null,
): CanvasThemeScope {
  // Original/pageColors rendering needs no prototype interception when there
  // is no enclosing perceptual theme scope. Keep nested scope semantics.
  if (!options && scopes.length === 0) return { release() {} };
  installHooks();

  const scope: ThemeScope = {
    mapper: mapperFor(options),
    released: false,
  };

  scopes.push(scope);
  refreshActiveMapper();

  return {
    release() {
      if (scope.released) {
        return;
      }

      scope.released = true;
      const index = scopes.indexOf(scope);

      if (index >= 0) {
        scopes.splice(index, 1);
      }

      refreshActiveMapper();

      if (scopes.length === 0) {
        uninstallHooks();
      }
    },
  };
}
