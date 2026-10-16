// Broad dimensions surround finer dimensions. Count distinct values in the
// currently displayed tasks, then prefer dimensions covering more tasks.
export function associationDimensions(tasks, preferred = []) {
    const dimensions = new Map(preferred.map(type => [type, { type, values: new Set(), taskCount: 0 }]));
    for (const task of tasks) {
        const seen = new Set();
        for (const { type, value } of task.associations || []) {
            if (!dimensions.has(type)) dimensions.set(type, { type, values: new Set(), taskCount: 0 });
            const dimension = dimensions.get(type);
            dimension.values.add(value.toLowerCase());
            if (!seen.has(type)) dimension.taskCount++;
            seen.add(type);
        }
    }
    return [...dimensions.values()].map(({ type, values, taskCount }) => ({ type, count: values.size, taskCount }));
}

export function automaticHierarchy(tasks) {
    return associationDimensions(tasks).sort((a, b) => a.count - b.count
        || b.taskCount - a.taskCount || a.type.localeCompare(b.type)).map(item => item.type);
}

export function buildTaskTable(tasks, hierarchy = automaticHierarchy(tasks)) {
    const order = [...new Set(hierarchy)];
    function group(items, depth, path) {
        if (depth === order.length) return { tasks: items, groups: [] };
        const type = order[depth];
        const buckets = new Map();
        for (const task of items) {
            const values = [...new Map((task.associations || []).filter(item => item.type === type)
                .map(item => [item.value.toLowerCase(), item.value])).entries()]
                .sort(([a], [b]) => a.localeCompare(b));
            // Group a multi-value dimension as a set rather than duplicating a
            // task across its Cartesian product of associations.
            const key = JSON.stringify(values.map(([key]) => key));
            if (!buckets.has(key)) buckets.set(key, { values: values.map(([, value]) => value), tasks: [] });
            buckets.get(key).tasks.push(task);
        }
        if ([...buckets.values()].every(bucket => !bucket.values.length)) return group(items, depth + 1, path);
        return {
            tasks: [],
            groups: [...buckets.entries()].map(([key, bucket]) => {
                const nextPath = [...path, [type, key]];
                return { type, values: bucket.values, count: bucket.tasks.length, key: JSON.stringify(nextPath),
                    ...group(bucket.tasks, depth + 1, nextPath) };
            }).sort((a, b) => Number(!a.values.length) - Number(!b.values.length)
                || a.values.join(' · ').localeCompare(b.values.join(' · '), undefined, { numeric: true }))
        };
    }
    return group(tasks, 0, []);
}
