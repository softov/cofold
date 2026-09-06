import { coerce, createRegistry, output } from "softcli";

/**
 * One registry, two programs.
 *
 * The server routes HTTP at these commands; the client builds the same
 * commands out of the manifest they describe. Neither side hand-writes the
 * other's half, and the only thing that crosses the wire is data - which is the
 * property that makes this possible at all.
 *
 * `meta.http` is the one extra fact: how a command becomes a request. The core
 * ignores it; `softcli/remote` reads it from both ends.
 */

export interface Pet {
  id: string;
  name: string;
  species: string;
  age: number | null;
}

const pets: Pet[] = [
  { id: "1", name: "Ada", species: "cat", age: 4 },
  { id: "2", name: "Byte", species: "dog", age: 2 },
];

export const registry = createRegistry({
  groups: [{ name: "pets", title: "Pets", agent: true }],
}).provide("pets", {
  description: "The in-memory pet store",
  resolve: () => pets,
});

const list = registry.command({
  id: "pet.list",
  group: "pets",
  pattern: ["pet", "list"],
  summary: "List the pets",
  needs: ["pets"],
  surfaces: { mcp: true },
  options: [
    { name: "--species", value: "SPECIES", description: "Only this species" },
    { name: "--limit", short: "-n", value: "N", description: "How many", coerce: coerce.integer({ min: 1 }), default: 50 },
  ],
  meta: { http: { method: "GET", path: "/pets", query: ["species", "limit"] } },
  run: (context) => output(context.pets
    .filter((pet) => context.optional("species") === undefined || pet.species === context.value("species"))
    .slice(0, context.value<number>("limit"))),
});

const show = registry.command({
  id: "pet.show",
  group: "pets",
  pattern: ["pet", "show", ":id"],
  summary: "Show one pet",
  arguments: { id: { description: "The pet's id" } },
  needs: ["pets"],
  surfaces: { mcp: true },
  meta: { http: { method: "GET", path: "/pets/{id}" } },
  run: (context) => {
    const pet = context.pets.find((one) => one.id === context.value("id"));
    if (pet === undefined) throw new NotFound(`There is no pet ${context.value("id")}`);
    return output(pet);
  },
});

const add = registry.command({
  id: "pet.add",
  group: "pets",
  pattern: ["pet", "add", ":name"],
  summary: "Add a pet",
  arguments: { name: { description: "What it answers to" } },
  needs: ["pets"],
  options: [
    { name: "--species", value: "SPECIES", description: "What it is", default: "cat" },
    { name: "--age", value: "YEARS", description: "How old", coerce: coerce.integer({ min: 0 }) },
  ],
  meta: { http: { method: "POST", path: "/pets", body: ["name", "species", "age"] } },
  run: (context) => {
    const pet: Pet = {
      id: String(context.pets.length + 1),
      name: context.value("name"),
      species: context.value("species"),
      age: context.optional<number>("age") ?? null,
    };
    context.pets.push(pet);
    return output(pet, `Added pet ${pet.id}\n`, pet.id);
  },
});

const remove = registry.command({
  id: "pet.remove",
  group: "pets",
  pattern: ["pet", "rm", ":id"],
  summary: "Remove a pet",
  needs: ["pets"],
  meta: { http: { method: "DELETE", path: "/pets/{id}" } },
  run: (context) => {
    const at = context.pets.findIndex((one) => one.id === context.value("id"));
    if (at === -1) throw new NotFound(`There is no pet ${context.value("id")}`);
    const [removed] = context.pets.splice(at, 1);
    return output(removed, `Removed pet ${removed!.id}\n`, removed!.id);
  },
});

export class NotFound extends Error {
  public readonly status = 404;
}

registry.register(list, show, add, remove);
