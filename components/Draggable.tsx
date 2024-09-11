'use client'

import { useDraggable } from '@dnd-kit/core';
  
interface DraggableProps {
  id: string;
}

const Draggable: React.FC<DraggableProps> = ({ id }) => {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id,
  });

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      Draggable Item
    </div>
  );
};

export default Draggable;