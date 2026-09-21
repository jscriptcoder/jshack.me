/**
 * The names of the people who live on generated machines.
 *
 * An account named `mrodriguez` is somebody whose surname is Rodriguez and whose first
 * name starts with M, so first names are grouped by initial: the account fixes the
 * letter, and the draw picks the person. Every initial an account can start with has
 * several names, so two `jsmith`s on one network are rarely the same J. Smith.
 */

export const FIRST_NAMES_BY_INITIAL: Readonly<Record<string, readonly string[]>> = {
  a: ['Aisha', 'Alex', 'Amara', 'Andrea', 'Anton', 'Ana', 'Arjun', 'Astrid'],
  b: ['Bea', 'Ben', 'Bianca', 'Boris', 'Bruno', 'Brigid', 'Bashir'],
  c: ['Carla', 'Chidi', 'Chloe', 'Conor', 'Cyrus', 'Camille', 'Chen'],
  d: ['Dana', 'Dario', 'Dev', 'Diana', 'Dmitri', 'Dolores', 'Duc'],
  e: ['Elena', 'Emeka', 'Emil', 'Esther', 'Ezra', 'Eun-ji', 'Evie'],
  f: ['Fatima', 'Felix', 'Fiona', 'Florin', 'Freya', 'Farid'],
  g: ['Gabriel', 'Greta', 'Gustavo', 'Gwen', 'Grace', 'Goran'],
  h: ['Hana', 'Harvey', 'Hector', 'Helga', 'Hiro', 'Hollis', 'Hye-jin'],
  i: ['Ibrahim', 'Ines', 'Ingrid', 'Isaac', 'Ivy', 'Imani'],
  j: ['Jamal', 'Jana', 'Javier', 'Jess', 'Joaquin', 'Josie', 'Jun', 'Julia'],
  k: ['Kai', 'Karin', 'Kemal', 'Kenji', 'Kira', 'Kofi', 'Kate'],
  l: ['Lars', 'Leila', 'Leon', 'Lina', 'Lorenzo', 'Lucia', 'Luka'],
  m: ['Malik', 'Marta', 'Mateo', 'Maya', 'Mei', 'Miguel', 'Mona', 'Marco'],
  n: ['Nadia', 'Naveen', 'Nell', 'Nico', 'Nina', 'Noor', 'Nathan'],
  o: ['Oksana', 'Olga', 'Omar', 'Oscar', 'Otto', 'Olivia'],
  p: ['Pablo', 'Paloma', 'Pat', 'Petra', 'Pia', 'Priya', 'Piotr'],
  q: ['Quentin', 'Quinn', 'Qadira', 'Quim', 'Qiu'],
  r: ['Rafael', 'Rania', 'Remy', 'Rosa', 'Ruben', 'Ruth', 'Ravi'],
  s: ['Sam', 'Sana', 'Santiago', 'Sienna', 'Sofia', 'Stefan', 'Sunil'],
  t: ['Tamar', 'Teo', 'Thandiwe', 'Theo', 'Tomas', 'Tove', 'Trang'],
  u: ['Ulla', 'Umar', 'Uma', 'Ursula', 'Uriel'],
  v: ['Valeria', 'Vera', 'Victor', 'Vikram', 'Vivian', 'Vlad'],
  w: ['Walter', 'Wanda', 'Wei', 'Wendell', 'Wren', 'Wilma'],
  x: ['Xavier', 'Ximena', 'Xiu', 'Xander', 'Xenia'],
  y: ['Yara', 'Yasmin', 'Yusuf', 'Yuki', 'Yves'],
  z: ['Zainab', 'Zara', 'Zeno', 'Zoe', 'Zoltan'],
};

/** Surnames keyed by how an account spells them, so `mrodriguez` reads back as
 *  Rodriguez. Also the pool a job-named account's person draws a surname from. */
export const SURNAMES: ReadonlyMap<string, string> = new Map(
  [
    'Smith', 'Rodriguez', 'Wilson', 'Thompson', 'Lee', 'Johnson', 'Garcia', 'Chen', 'Patel',
    'Williams', 'Kim', 'Nguyen', 'Schmidt', 'Okafor', 'Novak', 'Haddad', 'Kowalski', 'Moreau',
    'Rossi', 'Tanaka', 'Silva', 'Ivanova', 'Lindqvist', 'Mensah', 'Fernandes', 'Brennan',
    'Castillo', 'Dubois', 'Eriksen', 'Hoffmann', 'Jovanovic', 'Kaur', 'Larsen', 'Mbeki',
    'Nakamura', "O'Neill", 'Petrov', 'Quintero', 'Reyes', 'Sato', 'Torres', 'Visser',
    'Walsh', 'Yilmaz', 'Zhang', 'Abbott', 'Baptiste', 'Costa', 'Delgado', 'Fischer',
  ].map((surname) => [surname.toLowerCase().replace(/[^a-z]/g, ''), surname]),
);
