'use client'

import { DndContext, DragEndEvent } from '@dnd-kit/core';
import Draggable from './Draggable';
import Droppable from './Droppable';
import { useState } from 'react';

const DragAndDropComponent: React.FC = () => {
  const [dropped, setDropped] = useState(false);

  const handleDragEnd = (event: DragEndEvent) => {
    const { over } = event;
    if (over && over.id === 'droppable') {
      setDropped(true);
    } else {
      setDropped(false);
    }
  };

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <Droppable id="droppable">
        {dropped ? <Draggable id="draggable-1" /> : "Drop Here"}
      </Droppable>
      {!dropped && <Draggable id="draggable-1" />}
    </DndContext>
  );
};

export default DragAndDropComponent;