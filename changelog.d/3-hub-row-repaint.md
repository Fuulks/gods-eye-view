- The OneIntOS Stations layer row now follows the one-second relabel tick: when the layer text changes (for
  example to NOT CURRENT after the hub stops answering) the row is repainted at once instead of when the next
  poll attempt finishes, which could be up to one poll period late (Fuulks, #3).
