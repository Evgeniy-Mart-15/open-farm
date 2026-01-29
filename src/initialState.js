// Начальное состояние фермы (совпадает с frontend createInitialState)

export function getInitialFarmState() {
  return {
    level: 1,
    resources: {
      coins: 100,
      gems: 5,
      tomato: 0,
      cucumber: 0,
      milk: 0,
      egg: 0,
      feed: 5
    },
    crops: [
      { id: 'c1', type: 'tomato', level: 1, baseYield: 3, timer: null },
      { id: 'c2', type: 'cucumber', level: 1, baseYield: 2, timer: null },
      { id: 'c3', type: 'tomato', level: 1, baseYield: 2, timer: null }
    ],
    animals: [
      { id: 'a1', type: 'cow', level: 1, baseYield: 1, timer: null },
      { id: 'a2', type: 'chicken', level: 1, baseYield: 1, timer: null }
    ]
  };
}
