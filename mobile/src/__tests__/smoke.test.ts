// Smoke test — verifica que el runner de Jest arranca correctamente.
// No prueba lógica de app. Se puede borrar o dejar como centinela de setup.
describe('runner setup', () => {
  it('arithmetic works', () => {
    expect(1 + 1).toBe(2);
  });
});
