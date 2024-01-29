package fib

func initFib() int {
	return 3 + 3
}

func Fib(n int) int {
	if n < 2 {
		return n
	}
	return Fib(n-1) + Fib(n-2)
}

func Fib2(n int) int {
	initFib()

	if n < 2 {
		return n
	}
	return Fib2(n-1) + Fib2(n-2)
}
