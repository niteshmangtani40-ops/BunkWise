let lastDate = new Date().toDateString();

export function startDateWatcher(callback) {

    setInterval(() => {

        const currentDate = new Date().toDateString();

        if (currentDate !== lastDate) {

            lastDate = currentDate;

            callback();

        }

    }, 1000);

}