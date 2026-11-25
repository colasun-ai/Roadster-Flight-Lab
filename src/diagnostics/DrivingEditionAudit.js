// Packaged Windows x86 check. Exercise the visible controls and the normal physics loop.
export async function auditDrivingEdition(switcher, getThrusters, diagnostics) {
  const el = id => document.getElementById(id);
  const frame = () => new Promise(requestAnimationFrame);
  function check(condition, message) {
    if (!condition) throw Error(message);
  }
  async function until(checkState, label, timeout = 40000) {
    const end = performance.now() + timeout;
    while (!checkState() && performance.now() < end) await frame();
    check(checkState(), label);
  }
  function key(type, code, keyName) {
    el('scene').dispatchEvent(new KeyboardEvent(type, {code, key: keyName, bubbles: true}));
  }
  check(el('driving-edition')?.textContent && !el('garage-city') && !el('city-enter') &&
    window.planR1?.available === false && !window.planR1.predict, 'Driving edition capability mismatch');
  const runs = [];
  for (const id of ['roadster', 'model3-performance-2018', 'model-y-performance-2026']) {
    if (switcher.active?.id !== id) {
      document.querySelector('[data-garage-vehicle="' + id + '"]').click();
      await until(() => !switcher.busy && switcher.active?.id === id, 'Vehicle loading failed: ' + id);
    }
    el('garage-start').click();
    const vehicle = switcher.active.vehicle;
    const jet = getThrusters();
    if (id === 'roadster') {
      el('slopes-open').click();
      const dialog = el('slope-selector');
      check(dialog.open, 'Slope picker missing');
      dialog.querySelector('.slope-groups').children[3].click();
      dialog.querySelector('[data-course="D5"]').click();
      dialog.querySelector('.slope-drive').click();
      check(!dialog.open, 'D5 selection failed');
    }
    await frame();
    await frame();
    const initialSteps = vehicle.steps;
    const start = vehicle.rootPose().p;
    const initialZ = start.z;
    key('keydown', 'KeyW', 'w');
    if (jet) key('keydown', 'ShiftLeft', 'Shift');
    try {
      await until(() => vehicle.forwardSpeed() > 3 && Math.abs(vehicle.rootPose().p.z - initialZ) > 2 &&
        (!jet || jet.fuel.consumed > 0), 'Driving input failed: ' + id, 85000);
      if (id === 'roadster') check(jet?.thrustNewtons > 0, 'Jet thrust missing');
      runs.push({id, speedKmh: vehicle.forwardSpeed() * 3.6, distanceZ: vehicle.rootPose().p.z - initialZ,
        ...(jet ? {course: 'D5', thrustN: jet.thrustNewtons, gasUsedKg: jet.fuel.consumed} : {})});
    } catch (error) {
      throw Error(error.message + ' ' + JSON.stringify({speed:vehicle.forwardSpeed(), start:initialZ,
        position:vehicle.rootPose().p, steps:vehicle.steps-initialSteps, ...diagnostics()}));
    } finally {
      if (jet) key('keyup', 'ShiftLeft', 'Shift');
      key('keyup', 'KeyW', 'w');
    }
    el('garage-open').click();
    await until(() => !el('garage').hidden, 'Garage return failed');
  }
  window.roadsterAudit.report({event: 'driving-edition-complete', passed: true, runs});
}
