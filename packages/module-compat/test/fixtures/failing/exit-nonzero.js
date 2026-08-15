// Deliberately fails, to prove `runFixture` surfaces a child's stderr rather
// than passing silently. Every other fixture's value depends on that: a
// harness that swallowed a non-zero exit would report a green suite no matter
// what the fixtures did.

process.stderr.write("fixture failed on purpose\n");
process.exit(1);
